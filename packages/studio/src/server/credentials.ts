import { mkdir } from 'node:fs/promises'
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
    return Bun.file(join(directory, encodeURIComponent(account)))
  }

  async function get(account: string) {
    const file = fileFor(account)
    if (!(await file.exists())) return
    const value = (await file.text()).trim()
    return value || undefined
  }

  return {
    get,
    async set(account, secret) {
      await mkdir(directory, { recursive: true })
      await Bun.write(fileFor(account), secret)
    },
    async has(account) {
      return (await get(account)) !== undefined
    },
  }
}

function keychainStore(): CredentialStore {
  return {
    async get(account) {
      const result = Bun.spawnSync({
        cmd: [
          'security',
          'find-generic-password',
          '-s',
          service,
          '-a',
          account,
          '-w',
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (result.exitCode !== 0) return
      const value = result.stdout.toString().trim()
      return value || undefined
    },
    async set(account, secret) {
      const result = Bun.spawnSync({
        cmd: [
          'security',
          'add-generic-password',
          '-s',
          service,
          '-a',
          account,
          '-w',
          secret,
          '-U',
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.toString().trim() || 'Unable to store credential',
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
