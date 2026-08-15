import { resolve } from 'path'

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm'

const lockFiles: [string, PackageManager][] = [
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
]

export async function detectPackageManager(cwd = process.cwd()): Promise<PackageManager> {
  for (const [lockFile, pm] of lockFiles) {
    if (await Bun.file(resolve(cwd, lockFile)).exists()) {
      return pm
    }
  }
  return 'npm'
}

export function getRunCommand(pm: PackageManager): string {
  return `${pm} run`
}

export function getAddCommand(pm: PackageManager): string {
  if (pm === 'npm') return 'npm install'
  return `${pm} add`
}
