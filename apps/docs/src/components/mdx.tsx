import { Step, Steps } from 'fumadocs-ui/components/steps'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'

export function getMdxComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    ...components,
  } satisfies MDXComponents
}

// Next.js requires this exact export name for global MDX components.
// biome-ignore lint/style/useNamingConvention: framework-owned export
export const useMDXComponents = getMdxComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMdxComponents>
}
