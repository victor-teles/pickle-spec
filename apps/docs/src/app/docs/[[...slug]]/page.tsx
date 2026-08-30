import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMdxComponents } from '@/components/mdx'
import { source } from '@/lib/source'

interface DocsRouteProps {
  params: Promise<{ slug?: string[] }>
}

export default async function DocsRoute({ params }: DocsRouteProps) {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  // JSX component identifiers must start with an uppercase letter.
  // biome-ignore lint/style/useNamingConvention: compiled MDX component
  const MdxContent = page.data.body

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{
        container: { role: 'navigation', 'aria-label': 'On this page' },
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MdxContent
          components={getMdxComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata({
  params,
}: DocsRouteProps): Promise<Metadata> {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  return {
    title: page.data.title,
    description: page.data.description,
  }
}
