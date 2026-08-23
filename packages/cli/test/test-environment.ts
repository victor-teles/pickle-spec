import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pickleHome = mkdtempSync(join(tmpdir(), 'pickle-cli-tests-'))

process.env.PICKLE_HOME = pickleHome

process.once('exit', () => {
  rmSync(pickleHome, { recursive: true, force: true })
})
