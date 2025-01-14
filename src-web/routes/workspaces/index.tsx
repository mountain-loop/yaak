import { createFileRoute } from '@tanstack/react-router'
import { RedirectToLatestWorkspace } from '../../components/RedirectToLatestWorkspace'

export const Route = createFileRoute('/workspaces/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <RedirectToLatestWorkspace />
}
