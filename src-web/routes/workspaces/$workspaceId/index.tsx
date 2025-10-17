import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../../../components/Workspace';

type WorkspaceSearchSchema = {
  environment_id?: string | null;
  cookie_jar_id?: string | null;
} & (
  | {
      request_id: string;
    }
  | {
      folder_id: string;
    }
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  | {}
);

export const Route = createFileRoute('/workspaces/$workspaceId/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchSchema => {
    const base: Pick<WorkspaceSearchSchema, 'environment_id' | 'cookie_jar_id'> = {
      environment_id: search.environment_id as string,
      cookie_jar_id: search.cookie_jar_id as string,
    };

    const requestId = search.request_id as string | undefined;
    const folderId = search.folder_id as string | undefined;
    if (requestId != null) {
      return { ...base, request_id: requestId };
    } else if (folderId) {
      return { ...base, folder_id: folderId };
    } else {
      return base;
    }
  },
});

function RouteComponent() {
  return <Workspace />;
}
