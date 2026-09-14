import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { Button } from '../../../components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible'

export function EvidenceDetails(props: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger
        className="group/details"
        render={<Button variant="ghost" size="sm" />}
      >
        {props.label}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="size-3 group-aria-expanded/details:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{props.children}</CollapsibleContent>
    </Collapsible>
  )
}
