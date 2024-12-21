import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../../../../components/Workspace';

export const Route = createFileRoute('/workspaces/$workspaceId/requests/$requestId')({
  component: RouteComponent,
});

function RouteComponent() {
  return <Workspace />;
}
