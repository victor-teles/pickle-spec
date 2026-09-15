import { loader } from 'fumadocs-core/source'
import { applyMdxPreset } from 'fumadocs-mdx/config'
import { defineDocs } from 'fumadocs-mdx/macro'

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    mdxOptions: applyMdxPreset({
      remarkNpmOptions: {
        persist: { id: 'package-manager' },
        packageManagers: [
          { name: 'npm', command: (command) => command },
          {
            name: 'pnpm',
            command: (command) =>
              command
                .replace(/^npm install --save-dev /gm, 'pnpm add -D ')
                .replace(/^npx pickle /gm, 'pnpm exec pickle '),
          },
          {
            name: 'Yarn',
            command: (command) =>
              command
                .replace(/^npm install --save-dev /gm, 'yarn add -D ')
                .replace(/^npx pickle /gm, 'yarn pickle '),
          },
          {
            name: 'Bun',
            command: (command) =>
              command
                .replace(/^npm install --save-dev /gm, 'bun add --dev ')
                .replace(/^npx pickle /gm, 'bunx pickle '),
          },
        ],
      },
    }),
  },
})

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})
