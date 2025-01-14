import { createFileRoute, Navigate, useParams } from '@tanstack/react-router'

// -----------------------------------------------------------------------------------
// IMPORTANT: This is a deprecated route. Since the active request is optional, it was
//   moved from a path param to a query parameter. This route does a redirect to the
//   parent, while preserving the active request.

export const Route = createFileRoute(
  '/workspaces/$workspaceId/requests/$requestId',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { workspaceId, requestId } = useParams({
    from: '/workspaces/$workspaceId/requests/$requestId',
  })
  return (
    <Navigate
      to="/workspaces/$workspaceId"
      params={{ workspaceId }}
      search={(prev) => ({ ...prev, requestId })}
    />
  )
}
