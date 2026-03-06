import type { GitCallbacks } from '@yaakapp-internal/git';
import { sync } from '../../init/sync';
import { promptCredentials } from './credentials';
import { promptDivergedStrategy } from './diverged';
import { addGitRemote } from './showAddRemoteDialog';
import { promptUncommittedChangesStrategy } from './uncommitted';

export function gitCallbacks(dir: string): GitCallbacks {
  return {
    addRemote: async () => {
      return addGitRemote(dir, 'origin');
    },
    promptCredentials: async ({ url, error }) => {
      const creds = await promptCredentials({ url, error });
      if (creds == null) throw new Error('Cancelled credentials prompt');
      return creds;
    },
    promptDiverged: async ({ remote, branch }) => {
      return promptDivergedStrategy({ remote, branch });
    },
    promptUncommittedChanges: async () => {
      return promptUncommittedChangesStrategy();
    },
    forceSync: () => sync({ force: true }),
  };
}
