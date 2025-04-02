import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { InlineCode } from './core/InlineCode';

interface Props {
  hide: () => void;
  workspaceMeta: WorkspaceMeta;
}

export function ManageWorkspaceEncryptionDialog({ workspaceMeta }: Props) {
  return (
    <div className="grid grid-rows-[minmax(0,1fr)_auto]">
      <p>
        Encryption is enabled for <InlineCode>{workspaceMeta.workspaceId}</InlineCode>
      </p>
    </div>
  );
}
