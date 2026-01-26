import { open } from '@tauri-apps/plugin-dialog';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { createGlobalModel, updateModel } from '@yaakapp-internal/models';
import { useState } from 'react';
import { appInfo } from '../lib/appInfo';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { showErrorToast } from '../lib/toast';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';

interface Props {
  hide: () => void;
}

// Detect path separator from an existing path (defaults to /)
function getPathSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

export function CloneGitRepositoryDialog({ hide }: Props) {
  const [url, setUrl] = useState<string>('');
  const [baseDirectory, setBaseDirectory] = useState<string>(appInfo.defaultProjectDir);
  const [directoryOverride, setDirectoryOverride] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoName = extractRepoName(url);
  const sep = getPathSeparator(baseDirectory);
  const computedDirectory = repoName ? `${baseDirectory}${sep}${repoName}` : baseDirectory;
  const directory = directoryOverride ?? computedDirectory;

  const handleSelectDirectory = async () => {
    const dir = await open({
      title: 'Select Directory',
      directory: true,
      multiple: false,
    });
    if (dir != null) {
      setBaseDirectory(dir);
      setDirectoryOverride(null);
    }
  };

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !directory) return;

    setIsCloning(true);
    setError(null);

    try {
      // Clone the repository
      await invokeCmd('cmd_git_clone', { url, dir: directory });

      // Create a new workspace
      const workspaceId = await createGlobalModel({ model: 'workspace', name: repoName });
      if (workspaceId == null) {
        throw new Error('Failed to create workspace');
      }

      // Get and update workspace meta to set the sync directory
      const workspaceMeta = await invokeCmd<WorkspaceMeta>('cmd_get_workspace_meta', {
        workspaceId,
      });
      await updateModel({
        ...workspaceMeta,
        settingSyncDir: directory,
      });

      // Navigate to the new workspace
      await router.navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId },
      });

      hide();
    } catch (err) {
      setError(String(err));
      showErrorToast({
        id: 'git-clone-error',
        title: 'Clone Failed',
        message: String(err),
      });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <VStack as="form" space={3} alignItems="start" className="pb-3" onSubmit={handleClone}>
      {error && (
        <Banner color="danger" className="w-full">
          {error}
        </Banner>
      )}

      <PlainInput
        required
        label="Repository URL"
        placeholder="https://github.com/user/repo.git"
        defaultValue={url}
        onChange={setUrl}
      />

      <PlainInput
        label="Directory"
        placeholder={appInfo.defaultProjectDir}
        defaultValue={directory}
        onChange={setDirectoryOverride}
        rightSlot={
          <IconButton
            size="xs"
            className="mr-0.5 !h-auto my-0.5"
            icon="folder"
            title="Browse"
            onClick={handleSelectDirectory}
          />
        }
      />

      <Button
        type="submit"
        color="primary"
        className="w-full mt-3"
        disabled={!url || !directory || isCloning}
        isLoading={isCloning}
      >
        {isCloning ? 'Cloning...' : 'Clone Repository'}
      </Button>
    </VStack>
  );
}

function extractRepoName(url: string): string {
  // Handle various Git URL formats:
  // https://github.com/user/repo.git
  // git@github.com:user/repo.git
  // https://github.com/user/repo
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback for SSH-style URLs
  const sshMatch = url.match(/:([^/]+?)(\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  return '';
}
