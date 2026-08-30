import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { TestRunManifest } from '../../results/test-run-store'
import type {
  AllureArchiveOptions,
  AllureResultsProjection,
} from '../allure-results'
import { projectAllureResults } from './allure-results-projection'

interface ZipEntry {
  name: Uint8Array
  contents: Uint8Array
  crc32: number
  offset: number
}

const zipLocalHeaderSize = 30
const zipCentralHeaderSize = 46
const zipEndSize = 22
const maximumZip32Value = 0xffff_ffff
const defaultMaximumArchiveBytes = 128 * 1024 * 1024

async function allureArchiveFiles(
  projection: AllureResultsProjection,
  options: AllureArchiveOptions,
): Promise<Map<string, File>> {
  const files: Record<string, string | Uint8Array> = {}
  let projectedBytes = 0
  const maximumBytes = options.maximumBytes ?? defaultMaximumArchiveBytes
  for (const { fileName, result } of projection.results) {
    const contents = `${JSON.stringify(result, null, 2)}\n`
    projectedBytes += Buffer.byteLength(contents)
    files[fileName] = contents
  }
  for (const { sourcePath, fileName } of projection.attachments) {
    const source = Bun.file(sourcePath)
    if (!(await source.exists())) {
      throw new Error(`Artifact source file is missing: ${sourcePath}`)
    }
    await assertAllureArtifactPath(sourcePath, options.artifactsDirectory)
    projectedBytes += (await stat(sourcePath)).size
    if (projectedBytes > maximumBytes) {
      throw new Error(
        `Allure ZIP exceeds the ${Math.floor(maximumBytes / 1024 / 1024)} MiB in-memory limit`,
      )
    }
    files[fileName] = await source.bytes()
  }
  if (projectedBytes > maximumBytes) {
    throw new Error(
      `Allure ZIP exceeds the ${Math.floor(maximumBytes / 1024 / 1024)} MiB in-memory limit`,
    )
  }
  return new Bun.Archive(files).files()
}

export async function assertAllureArtifactPath(
  sourcePath: string,
  artifactsDirectory: string,
): Promise<void> {
  const source = resolve(sourcePath)
  const allowed = resolve(artifactsDirectory)
  if (source !== allowed && !source.startsWith(`${allowed}${sep}`)) {
    throw new Error(`Artifact source path escapes the Test run: ${sourcePath}`)
  }
  const [realSource, realAllowed] = await Promise.all([
    realpath(source),
    realpath(allowed),
  ])
  if (
    realSource !== realAllowed &&
    !realSource.startsWith(`${realAllowed}${sep}`)
  ) {
    throw new Error(`Artifact source path escapes the Test run: ${sourcePath}`)
  }
}

async function zipEntries(files: Map<string, File>): Promise<ZipEntry[]> {
  if (files.size > 0xffff) {
    throw new Error('Allure ZIP contains more than 65,535 files')
  }
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = []
  let offset = 0
  for (const [path, file] of files) {
    const name = encoder.encode(path)
    const contents = new Uint8Array(await file.arrayBuffer())
    if (name.byteLength > 0xffff) {
      throw new Error(`Allure ZIP file name is too long: ${path}`)
    }
    if (contents.byteLength > maximumZip32Value) {
      throw new Error(`Allure ZIP file is larger than 4 GiB: ${path}`)
    }
    entries.push({
      name,
      contents,
      crc32: Bun.hash.crc32(contents) >>> 0,
      offset,
    })
    offset += zipLocalHeaderSize + name.byteLength + contents.byteLength
  }
  return entries
}

function writeLocalEntry(
  output: Uint8Array,
  view: DataView,
  entry: ZipEntry,
): void {
  const offset = entry.offset
  view.setUint32(offset, 0x04034b50, true)
  view.setUint16(offset + 4, 20, true)
  view.setUint16(offset + 6, 0x0800, true)
  view.setUint16(offset + 8, 0, true)
  view.setUint32(offset + 14, entry.crc32, true)
  view.setUint32(offset + 18, entry.contents.byteLength, true)
  view.setUint32(offset + 22, entry.contents.byteLength, true)
  view.setUint16(offset + 26, entry.name.byteLength, true)
  output.set(entry.name, offset + zipLocalHeaderSize)
  output.set(
    entry.contents,
    offset + zipLocalHeaderSize + entry.name.byteLength,
  )
}

function writeCentralEntry(
  output: Uint8Array,
  view: DataView,
  entry: ZipEntry,
  offset: number,
): number {
  view.setUint32(offset, 0x02014b50, true)
  view.setUint16(offset + 4, 20, true)
  view.setUint16(offset + 6, 20, true)
  view.setUint16(offset + 8, 0x0800, true)
  view.setUint16(offset + 10, 0, true)
  view.setUint32(offset + 16, entry.crc32, true)
  view.setUint32(offset + 20, entry.contents.byteLength, true)
  view.setUint32(offset + 24, entry.contents.byteLength, true)
  view.setUint16(offset + 28, entry.name.byteLength, true)
  view.setUint32(offset + 42, entry.offset, true)
  output.set(entry.name, offset + zipCentralHeaderSize)
  return offset + zipCentralHeaderSize + entry.name.byteLength
}

function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  const localSize = entries.reduce(
    (total, entry) =>
      total +
      zipLocalHeaderSize +
      entry.name.byteLength +
      entry.contents.byteLength,
    0,
  )
  const centralSize = entries.reduce(
    (total, entry) => total + zipCentralHeaderSize + entry.name.byteLength,
    0,
  )
  const totalSize = localSize + centralSize + zipEndSize
  if (totalSize > maximumZip32Value) {
    throw new Error('Allure ZIP is larger than the ZIP32 in-memory limit')
  }
  const output = new Uint8Array(totalSize)
  const view = new DataView(output.buffer)
  for (const entry of entries) writeLocalEntry(output, view, entry)
  let centralOffset = localSize
  for (const entry of entries) {
    centralOffset = writeCentralEntry(output, view, entry, centralOffset)
  }
  view.setUint32(centralOffset, 0x06054b50, true)
  view.setUint16(centralOffset + 8, entries.length, true)
  view.setUint16(centralOffset + 10, entries.length, true)
  view.setUint32(centralOffset + 12, centralSize, true)
  view.setUint32(centralOffset + 16, localSize, true)
  return output
}

export async function createAllureResultsZip(
  manifest: TestRunManifest,
  options: AllureArchiveOptions,
): Promise<Uint8Array> {
  const files = await allureArchiveFiles(
    projectAllureResults(manifest),
    options,
  )
  return storedZip(await zipEntries(files))
}
