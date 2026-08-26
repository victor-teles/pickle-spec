import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StudioApp } from './app/studio-app'
import { StudioShellSkeleton } from './components/loading-skeletons'
import { Toaster } from './components/ui/toast'
import { TooltipProvider } from './components/ui/tooltip'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Studio root element is missing')

createRoot(root).render(
  <StrictMode>
    <Toaster>
      <TooltipProvider>
        <StudioApp loadingFallback={<StudioShellSkeleton />} />
      </TooltipProvider>
    </Toaster>
  </StrictMode>,
)
