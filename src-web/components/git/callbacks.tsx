import type { GitCallbacks } from '@yaakapp-internal/git';
import { sync } from '../../init/sync';
import { promptCredentials } from './credentials';
import { promptDivergedStrategy } from './diverged';
import { promptUncommittedChangesStrategy } from './uncommitted';
import { addGitRemote } from './showAddRemoteDialog';

export function gitCallbacks(dir: string): GitCallbacks {
  return {
    addRemote: async () => {
      return addGitRemote(dir);
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
