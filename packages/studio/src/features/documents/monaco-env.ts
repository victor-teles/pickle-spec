const monacoWorkerSource = 'self.onmessage = function () {}'

function monacoWorker() {
  return new Worker(
    URL.createObjectURL(
      new Blob([monacoWorkerSource], { type: 'text/javascript' }),
    ),
  )
}

export async function loadMonaco() {
  globalThis.MonacoEnvironment ??= { globalAPI: true, getWorker: monacoWorker }
  return import('monaco-editor/editor/editor.main.js')
}
