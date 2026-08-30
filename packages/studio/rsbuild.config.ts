import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import tailwindcss from '@tailwindcss/postcss'
import { tanstackStart } from '@tanstack/react-start/plugin/rsbuild'

export default defineConfig({
  plugins: [pluginReact(), tanstackStart()],
  tools: {
    postcss(_config, { addPlugins }) {
      addPlugins(tailwindcss())
    },
  },
})
