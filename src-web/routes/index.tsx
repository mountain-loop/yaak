import { createFileRoute } from '@tanstack/react-router'
import { RedirectToLatestWorkspace } from '../components/RedirectToLatestWorkspace'

export const Route = createFileRoute('/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <RedirectToLatestWorkspace />
}
