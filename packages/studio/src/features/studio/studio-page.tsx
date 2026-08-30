import { StrictMode } from 'react'
import { StudioShellSkeleton } from '../../components/loading-skeletons'
import { Toaster } from '../../components/ui/toast'
import { TooltipProvider } from '../../components/ui/tooltip'
import { StudioApp } from './studio-app'
import '../../styles.css'

export function StudioPage() {
  return (
    <StrictMode>
      <Toaster>
        <TooltipProvider>
          <StudioApp loadingFallback={<StudioShellSkeleton />} />
        </TooltipProvider>
      </Toaster>
    </StrictMode>
  )
}
