import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default function setupTestEnvironment(): () => void {
  const pickleHome = mkdtempSync(join(tmpdir(), 'pickle-cli-tests-'))

  process.env.PICKLE_HOME = pickleHome

  return () => rmSync(pickleHome, { recursive: true, force: true })
}
