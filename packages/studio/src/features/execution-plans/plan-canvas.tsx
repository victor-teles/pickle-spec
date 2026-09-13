import type {
  ExecutionPlanOperationDisplay,
  ExecutionPlanStepDisplay,
  ExecutionPlanUncachedStep,
} from '@pickle-spec/runner'
import {
  Background,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type Node,
  type NodeProps,
  type XYPosition,
} from '@xyflow/react'
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { cn } from '../../lib/utils'
import { PlanOperation, type PlanStepFocus, templateText } from './plan-steps'
import '@xyflow/react/dist/style.css'
import './plan-canvas.css'

interface PlanCanvasProps {
  steps: readonly ExecutionPlanStepDisplay[]
  uncachedTail: readonly ExecutionPlanUncachedStep[]
  focusStep?: PlanStepFocus
  blocked?: boolean
  editing?: boolean
  status?: string
  onSelect?(
    this: void,
    operation: ExecutionPlanOperationDisplay,
    stepIndex: number,
    button: HTMLButtonElement,
  ): void
  renderDetails?(
    this: void,
    operation: ExecutionPlanOperationDisplay,
    stepIndex: number,
  ): ReactNode
}

type PlanNode = Node<
  {
    step: ExecutionPlanStepDisplay
    uncached: boolean
    focused: boolean
    selectedOperation?: number
    blocked: boolean
    editable: boolean
    editing: boolean
    ready: boolean
    renderDetails?: PlanCanvasProps['renderDetails']
    reveal(): void
    onSelect(
      operation: ExecutionPlanOperationDisplay,
      stepIndex: number,
      button: HTMLButtonElement,
    ): void
  },
  'step'
>

function operationTargetText(operation: ExecutionPlanOperationDisplay) {
  if (operation.target) return templateText(operation.target.selector)
  return operation.check ? 'Protected check' : 'Read-only'
}

const StepContent = memo(function StepContent({
  data,
}: {
  data: PlanNode['data']
}) {
  const stepRef = useRef<HTMLDivElement>(null)
  const selectedButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(data.editing)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (data.focused && data.ready)
        stepRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [data.focused, data.ready])
  useEffect(() => {
    const finished = wasEditing.current && !data.editing
    wasEditing.current = data.editing
    const frame = requestAnimationFrame(() => {
      if (finished) selectedButtonRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [data.editing])
  return (
    <Card
      size="sm"
      ref={stepRef}
      tabIndex={data.focused ? -1 : undefined}
      data-state={data.focused ? 'selected' : undefined}
      className={cn(
        'plan-step gap-0 shadow-sm',
        data.focused && 'border-destructive',
        data.uncached && 'border-dashed',
      )}
    >
      <CardHeader className="plan-drag-handle cursor-grab border-b border-border pb-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {String(data.step.index + 1).padStart(2, '0')} /{' '}
            {data.step.keyword.trim()}
          </span>
          {data.uncached ? (
            <Badge>Uncached</Badge>
          ) : (
            <span>{data.step.operations.length} actions</span>
          )}
        </div>
        <CardTitle className="break-words text-sm leading-relaxed">
          {data.step.text}
        </CardTitle>
        {data.focused ? (
          <p className="text-xs text-destructive">Recorded failed step</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1 pt-2">
        {data.step.operations.map((operation) => (
          <div key={operation.index}>
            <Button
              ref={
                data.selectedOperation === operation.index
                  ? selectedButtonRef
                  : undefined
              }
              variant="ghost"
              className="nodrag h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-2 py-2 text-left text-foreground"
              aria-label={`${data.editable && operation.editable && operation.target ? 'Edit locator' : 'Inspect action'}: ${operation.summary}`}
              aria-pressed={data.selectedOperation === operation.index}
              disabled={
                data.blocked && data.selectedOperation !== operation.index
              }
              aria-disabled={data.blocked}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible')) data.reveal()
              }}
              onClick={(event) =>
                data.onSelect(operation, data.step.index, event.currentTarget)
              }
            >
              <Badge className="shrink-0 font-mono">
                {operation.check ? '✓' : '→'}
              </Badge>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-xs font-medium">
                  {operation.summary}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {operationTargetText(operation)}
                </span>
              </span>
            </Button>
            {data.selectedOperation === operation.index ? (
              <div className="nodrag nopan nowheel min-w-0 px-2 pb-3">
                {data.renderDetails ? (
                  data.renderDetails(operation, data.step.index)
                ) : (
                  <PlanOperation operation={operation} />
                )}
              </div>
            ) : null}
          </div>
        ))}
        {data.uncached ? (
          <p className="py-2 text-xs text-muted-foreground">
            No cached actions. Record this step to include it in Replay.
          </p>
        ) : null}
        {!data.uncached && !data.step.operations.length ? (
          <p className="py-2 text-xs text-muted-foreground">
            No recorded actions.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
})

function StepNode({ data }: NodeProps<PlanNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <StepContent data={data} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

const nodeTypes = { step: StepNode }

function CanvasWorkspace(props: PlanCanvasProps) {
  const [selection, setSelection] = useState<{
    stepIndex: number
    operationIndex: number
  }>()
  const [positions, setPositions] = useState<Record<string, XYPosition>>({})
  const [measurements, setMeasurements] = useState<
    Record<string, NonNullable<PlanNode['measured']>>
  >({})
  const [view, setView] = useState<'canvas' | 'list'>('canvas')
  const flow = useReactFlow<PlanNode>()
  const nodesInitialized = useNodesInitialized()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [expandError, setExpandError] = useState('')
  useEffect(() => {
    const update = () =>
      setExpanded(document.fullscreenElement === workspaceRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  async function toggleExpand() {
    try {
      if (expanded) await document.exitFullscreen()
      else await workspaceRef.current?.requestFullscreen()
      setExpandError('')
    } catch {
      setExpandError(
        'Fullscreen is unavailable. Resize the Plan panel to make more room.',
      )
    }
  }
  const steps = useMemo(
    () => [
      ...props.steps,
      ...props.uncachedTail.map((step) => ({ ...step, operations: [] })),
    ],
    [props.steps, props.uncachedTail],
  )
  const focused = steps.find(
    (step) =>
      step.index === props.focusStep?.index &&
      step.keyword === props.focusStep.keyword &&
      step.text === props.focusStep.text,
  )
  const focusedIndex = focused?.index
  useEffect(() => {
    if (focusedIndex === undefined || view !== 'canvas' || !nodesInitialized)
      return
    void flow.fitView({
      nodes: [{ id: String(focusedIndex) }],
      maxZoom: 1,
      padding: 0.3,
    })
  }, [focusedIndex, view, flow, nodesInitialized])

  const baseNodes = useMemo<PlanNode[]>(
    () =>
      steps.map((step, index) => ({
        id: String(step.index),
        type: 'step',
        position: { x: index * 376, y: 0 },
        width: 320,
        dragHandle: '.plan-drag-handle',
        data: {
          step,
          uncached: index >= props.steps.length,
          focused: step === focused,
          selectedOperation:
            selection?.stepIndex === step.index
              ? selection.operationIndex
              : undefined,
          blocked: Boolean(props.blocked),
          editable: Boolean(props.onSelect),
          editing: Boolean(props.editing),
          renderDetails: props.renderDetails,
          ready: view === 'list' || nodesInitialized,
          reveal: () => {
            if (view === 'canvas')
              void flow.fitView({
                nodes: [{ id: String(step.index) }],
                maxZoom: 1,
                padding: 0.2,
              })
          },
          onSelect: (operation, stepIndex, button) => {
            if (props.blocked) return
            setSelection({ stepIndex, operationIndex: operation.index })
            props.onSelect?.(operation, stepIndex, button)
          },
        },
      })),
    [
      steps,
      focused,
      selection,
      props.blocked,
      props.onSelect,
      props.editing,
      props.renderDetails,
      props.steps.length,
      view,
      nodesInitialized,
      flow,
    ],
  )
  const nodes = useMemo(
    () =>
      baseNodes.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
        measured: measurements[node.id],
      })),
    [baseNodes, positions, measurements],
  )
  const edges = useMemo<Edge[]>(
    () =>
      baseNodes.flatMap((node, index) => {
        const previous = baseNodes[index - 1]
        if (!previous) return []
        return [
          {
            id: `${previous.id}-${node.id}`,
            source: previous.id,
            target: node.id,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeDasharray: node.data.uncached ? '5 5' : undefined },
          },
        ]
      }),
    [baseNodes],
  )
  return (
    <div
      ref={workspaceRef}
      className={cn(
        '@container/plan min-w-0',
        expanded && 'overflow-auto bg-background p-5',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Execution plan</span>
          {steps.length} steps ·{' '}
          {props.steps.reduce(
            (total, step) => total + step.operations.length,
            0,
          )}{' '}
          actions
        </p>
        <div className="flex gap-1" role="group" aria-label="Plan view">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void toggleExpand()}
          >
            {expanded ? 'Exit fullscreen' : 'Expand'}
          </Button>
          <Button
            size="sm"
            variant={view === 'canvas' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'canvas'}
            disabled={Boolean(props.editing)}
            onClick={() => setView('canvas')}
          >
            Canvas
          </Button>
          <Button
            size="sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'list'}
            disabled={Boolean(props.editing)}
            onClick={() => setView('list')}
          >
            List
          </Button>
        </div>
      </div>
      {expandError ? (
        <p role="status" className="mb-2 text-xs">
          {expandError}
        </p>
      ) : null}
      {props.focusStep && !focused ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          The recorded failed step does not match the current Gherkin plan, so
          failed-step focus is unavailable.
        </p>
      ) : null}
      <div className="min-w-0">
        {view === 'canvas' ? (
          <div
            className={cn(
              'plan-canvas min-w-0 overflow-hidden rounded-xl border border-border',
              expanded ? 'h-[calc(100dvh-140px)] min-h-[560px]' : 'h-[560px]',
            )}
            aria-label="Execution plan canvas"
          >
            <ReactFlow<PlanNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                setPositions((current) => {
                  let next = current
                  for (const change of changes) {
                    if (change.type !== 'position' || !change.position) continue
                    if (
                      next[change.id]?.x === change.position.x &&
                      next[change.id]?.y === change.position.y
                    )
                      continue
                    next = { ...next, [change.id]: change.position }
                  }
                  return next
                })
                for (const change of changes) {
                  if (change.type !== 'dimensions' || !change.dimensions)
                    continue
                  const dimensions = change.dimensions
                  setMeasurements((current) => {
                    if (
                      current[change.id]?.width === dimensions.width &&
                      current[change.id]?.height === dimensions.height
                    )
                      return current
                    return { ...current, [change.id]: dimensions }
                  })
                }
              }}
              colorMode="dark"
              defaultViewport={{ x: 28, y: 28, zoom: 1 }}
              minZoom={0.25}
              maxZoom={1.5}
              nodesConnectable={false}
              edgesFocusable={false}
              nodesFocusable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              preventScrolling={false}
            >
              <Background gap={20} size={1} />
              <Panel
                position="bottom-left"
                className="flex gap-1 rounded-lg border border-border bg-card p-1"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Zoom out"
                  onClick={() => void flow.zoomOut()}
                >
                  −
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Zoom in"
                  onClick={() => void flow.zoomIn()}
                >
                  +
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void flow.fitView({ padding: 0.15, maxZoom: 1 })
                  }
                >
                  Fit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPositions({})
                    void flow.setViewport({ x: 28, y: 28, zoom: 1 })
                  }}
                >
                  Arrange
                </Button>
              </Panel>
            </ReactFlow>
          </div>
        ) : (
          <ol
            aria-label="Plan steps"
            className="grid min-w-0 content-start gap-3"
          >
            {nodes.map((node) => (
              <li key={node.id}>
                <StepContent data={node.data} />
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Select an action to {props.onSelect ? 'edit its locator' : 'inspect it'}{' '}
        · Drag to arrange · Execution order stays fixed
      </p>
      {props.status ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {props.status}
        </p>
      ) : null}
    </div>
  )
}

export function PlanCanvas(props: PlanCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspace {...props} />
    </ReactFlowProvider>
  )
}
