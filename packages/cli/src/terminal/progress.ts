import ora from 'ora'

export interface TerminalProgress {
  start(label: string): void
  update(label: string): void
  stop(): void
}

interface TerminalProgressOptions {
  color: boolean
  enabled: boolean
  stream?: NodeJS.WritableStream
}

export function createTerminalProgress(
  options: TerminalProgressOptions,
): TerminalProgress {
  const spinner = ora({
    color: options.color ? 'cyan' : false,
    discardStdin: false,
    isEnabled: options.enabled,
    isSilent: !options.enabled,
    stream: options.stream ?? process.stderr,
  })

  return {
    start(label) {
      spinner.start(label)
    },
    update(label) {
      spinner.text = label
    },
    stop() {
      spinner.stop()
    },
  }
}
