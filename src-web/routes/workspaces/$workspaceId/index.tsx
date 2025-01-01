import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../../../components/Workspace';

interface WorkspaceSearchSchema {
  cookie_jar_id?: string | null;
  environment_id?: string | null;
}

export const Route = createFileRoute('/workspaces/$workspaceId/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchSchema => ({
    environment_id: search.environment_id as string,
    cookie_jar_id: search.cookie_jar_id as string,
  }),
});

function RouteComponent() {
  return <Workspace />;
}
