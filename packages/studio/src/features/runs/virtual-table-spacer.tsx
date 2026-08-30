import { TableCell, TableRow } from '../../components/ui/table'

interface VirtualTableSpacerProps {
  height: number
  colSpan: number
}

export function VirtualTableSpacer(props: VirtualTableSpacerProps) {
  if (props.height === 0) return null
  return (
    <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
      <TableCell
        colSpan={props.colSpan}
        className="p-0"
        style={{ height: props.height }}
      />
    </TableRow>
  )
}
