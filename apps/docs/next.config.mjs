import { fileURLToPath } from 'node:url'
import { createMDX } from 'fumadocs-mdx/next'

const withMdx = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
  },
}

export default withMdx(config)
