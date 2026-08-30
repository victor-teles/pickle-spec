import {
  listMobileApplications,
  type MobilePlatform,
} from '@pickle-spec/mobile'
import { requiredValue } from '../required-value'

interface AppsArguments {
  platform: MobilePlatform
  all: boolean
}

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${argv[index]} requires a value`)
  }
  return value
}

function mobilePlatform(value: string): MobilePlatform {
  if (value === 'android' || value === 'ios') return value
  throw new Error('--platform requires android or ios')
}

function parseAppsArguments(argv: string[]): AppsArguments {
  let platform: MobilePlatform | undefined
  let all = false
  for (let index = 1; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    if (flag === '--platform') {
      platform = mobilePlatform(valueAfter(argv, index++))
    } else if (flag === '--all') all = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  if (!platform) {
    throw new Error('Usage: pickle apps --platform android|ios [--all]')
  }
  return { platform, all }
}

export async function runAppsCommand(argv: string[]): Promise<number> {
  const args = parseAppsArguments(argv)
  const applicationIds = await listMobileApplications({
    platform: args.platform,
    scope: args.all ? 'all' : 'user-installed',
  })
  for (const applicationId of applicationIds) console.log(applicationId)
  return 0
}
