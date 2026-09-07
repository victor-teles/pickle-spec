const monacoWorkerSource = 'self.onmessage = function () {}'

function monacoWorker() {
  return new Worker(
    URL.createObjectURL(
      new Blob([monacoWorkerSource], { type: 'text/javascript' }),
    ),
  )
}

export function initializeMonacoEnvironment(): void {
  globalThis.MonacoEnvironment ??= { globalAPI: true, getWorker: monacoWorker }
}
