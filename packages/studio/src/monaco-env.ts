// biome-ignore-all lint/style/useNamingConvention: Monaco's global host uses these names
type MonacoEnvironmentHost = {
  MonacoEnvironment?: unknown
}

const monacoWorkerSource = 'self.onmessage = function () {}'

function monacoWorker() {
  return new Worker(
    URL.createObjectURL(
      new Blob([monacoWorkerSource], { type: 'text/javascript' }),
    ),
  )
}

const host = globalThis as MonacoEnvironmentHost
if (!host.MonacoEnvironment) {
  host.MonacoEnvironment = {
    globalAPI: true,
    getWorker: monacoWorker,
  }
}
