import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../../../components/Workspace';

interface WorkspaceSearchSchema {
  cookieJarId?: string | null;
  environmentId?: string | null;
}

export const Route = createFileRoute('/workspaces/$workspaceId/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchSchema => ({
    environmentId: search.environment_id as string,
    cookieJarId: search.cookie_jar_id as string,
  }),
});

function RouteComponent() {
  return <Workspace />;
}
