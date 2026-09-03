import { type ReactNode, useEffect, useState } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../../components/ui/resizable'

export type WorkbenchPanelVisibility = {
  bottom: boolean
  left: boolean
  right: boolean
}

type WorkbenchLayoutProps = {
  bottom: ReactNode
  center: ReactNode
  left: ReactNode
  orientation: WorkbenchOrientation
  right: ReactNode
  visibility: WorkbenchPanelVisibility
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  return (
    <ResizablePanelGroup
      key={`${props.orientation}-${visibilityKey(props.visibility)}`}
      id="specifications-workbench"
      orientation={props.orientation}
      className="min-h-0 min-w-0 flex-1"
    >
      {props.visibility.left ? (
        <>
          <ResizablePanel id="workbench-left" defaultSize="23%" minSize="15%">
            {props.left}
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      ) : null}
      <ResizablePanel id="workbench-main" defaultSize="54%" minSize="30%">
        <ResizablePanelGroup
          id="specifications-workbench-main"
          orientation="vertical"
          className="min-h-0 min-w-0"
        >
          <ResizablePanel
            id="workbench-preview"
            defaultSize={props.visibility.bottom ? '64%' : '100%'}
            minSize="25%"
          >
            {props.center}
          </ResizablePanel>
          {props.visibility.bottom ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="workbench-bottom"
                defaultSize="36%"
                minSize="18%"
              >
                {props.bottom}
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </ResizablePanel>
      {props.visibility.right ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="workbench-right" defaultSize="23%" minSize="15%">
            {props.right}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}

export type WorkbenchOrientation = 'horizontal' | 'vertical'

export function useWorkbenchOrientation(): WorkbenchOrientation {
  const [orientation, setOrientation] =
    useState<WorkbenchOrientation>('horizontal')

  useEffect(() => {
    const media = window.matchMedia('(min-width: 80rem)')
    const updateOrientation = () =>
      setOrientation(media.matches ? 'horizontal' : 'vertical')

    updateOrientation()
    media.addEventListener('change', updateOrientation)
    return () => media.removeEventListener('change', updateOrientation)
  }, [])

  return orientation
}

function visibilityKey(visibility: WorkbenchPanelVisibility): string {
  return [visibility.left, visibility.right, visibility.bottom]
    .map((visible) => (visible ? '1' : '0'))
    .join('')
}
