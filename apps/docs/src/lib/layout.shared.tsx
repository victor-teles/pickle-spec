import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { GitBranch } from 'lucide-react'
import Image from 'next/image'
import pickleIcon from '../../../../assets/brand/pickle-spec-icon.png'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold">
          <Image alt="" height={24} priority src={pickleIcon} width={24} />
          Pickle Spec
        </span>
      ),
    },
    links: [
      {
        type: 'icon',
        label: 'GitHub',
        text: 'GitHub',
        url: 'https://github.com/victor-teles/pickle-spec',
        external: true,
        icon: <GitBranch aria-hidden="true" />,
      },
    ],
  }
}
