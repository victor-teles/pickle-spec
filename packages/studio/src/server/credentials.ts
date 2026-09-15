import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const service = 'pickle-spec'

export interface CredentialStore {
  get(account: string): Promise<string | undefined>
  set(account: string, secret: string): Promise<void>
  has(account: string): Promise<boolean>
}

export function createDirectoryCredentialStore(
  directory: string,
): CredentialStore {
  function fileFor(account: string) {
    return join(directory, encodeURIComponent(account))
  }

  async function get(account: string): Promise<string | undefined> {
    const file = fileFor(account)
    if (!existsSync(file)) return undefined
    const value = (await readFile(file, 'utf8')).trim()
    return value || undefined
  }

  return {
    get,
    async set(account, secret) {
      await mkdir(directory, { recursive: true })
      await writeFile(fileFor(account), secret)
    },
    async has(account) {
      return (await get(account)) !== undefined
    },
  }
}

function keychainStore(): CredentialStore {
  return {
    async get(account): Promise<string | undefined> {
      const result = spawnSync(
        'security',
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      if (result.status !== 0) return undefined
      const value = (result.stdout ?? '').trim()
      return value || undefined
    },
    async set(account, secret) {
      const result = spawnSync(
        'security',
        [
          'add-generic-password',
          '-s',
          service,
          '-a',
          account,
          '-w',
          secret,
          '-U',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      if (result.status !== 0) {
        throw new Error(
          (result.stderr ?? result.error?.message ?? '').trim() ||
            'Unable to store credential',
        )
      }
    },
    async has(account) {
      return (await this.get(account)) !== undefined
    },
  }
}

export function createCredentialStore(): CredentialStore {
  const directory = process.env.PICKLE_KEYCHAIN_DIR
  if (directory) return createDirectoryCredentialStore(directory)
  if (process.platform === 'darwin') return keychainStore()
  return createDirectoryCredentialStore(
    join(homedir(), '.pickle', 'credentials'),
  )
}
