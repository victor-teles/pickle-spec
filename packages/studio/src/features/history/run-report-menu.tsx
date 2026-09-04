import type { TestRunExportFormat } from '@pickle-spec/runner'
import { useState } from 'react'
import { buttonVariants } from '../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { studioRunReportDescriptors } from './history.contracts'

type RunReportMenuProps = {
  align?: 'center' | 'end' | 'start'
  runId: string
}

export function RunReportMenu(props: RunReportMenuProps) {
  const [includeAllArtifacts, setIncludeAllArtifacts] = useState(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={buttonVariants({ variant: 'outline' })}
      >
        Download report
      </DropdownMenuTrigger>
      <DropdownMenuContent align={props.align ?? 'end'}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Report format</DropdownMenuLabel>
          {studioRunReportDescriptors.map((descriptor) => (
            <ReportDownloadItem
              key={descriptor.format}
              href={reportDownloadHref(
                props.runId,
                descriptor.format,
                includeAllArtifacts,
              )}
              label={descriptor.label}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>HTML options</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={includeAllArtifacts}
            closeOnClick={false}
            onCheckedChange={setIncludeAllArtifacts}
          >
            Include all artifacts in HTML report
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function reportDownloadHref(
  runId: string,
  format: TestRunExportFormat,
  includeAllArtifacts: boolean,
): string {
  const artifacts =
    format === 'html' && includeAllArtifacts ? '?artifacts=all' : ''
  return `/api/history/${encodeURIComponent(runId)}/${format}${artifacts}`
}

function ReportDownloadItem(props: { href: string; label: string }) {
  return (
    <DropdownMenuItem
      nativeButton={false}
      render={<a href={props.href} download />}
    >
      {props.label}
    </DropdownMenuItem>
  )
}
