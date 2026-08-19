process.once('SIGTERM', () => process.exit(0))
setTimeout(() => {
  process.stdout.write(
    `${JSON.stringify({
      version: 1,
      type: 'worker-ready',
      nodeVersion: process.versions.node,
    })}\n`,
  )
}, 10_000)
