import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

type RunsHeaderProps = {
  selectedRunCount: number
  onCompareSelected: () => void
  onImportArchive: (file?: File) => void
}

export function RunsHeader(props: RunsHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="space-y-1">
        <h1 id="runs-title" className="studio-display text-lg sm:text-xl">
          Runs
        </h1>
        <p className="text-sm text-muted-foreground">
          Live progress and persisted Test runs across every Specification.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept="application/json,.json"
          aria-label="Import run archive"
          className="max-w-64"
          onChange={(event) =>
            props.onImportArchive(event.currentTarget.files?.[0])
          }
        />
        <Button
          type="button"
          variant="outline"
          disabled={props.selectedRunCount !== 2}
          onClick={props.onCompareSelected}
        >
          Compare selected runs
        </Button>
      </div>
    </header>
  )
}
