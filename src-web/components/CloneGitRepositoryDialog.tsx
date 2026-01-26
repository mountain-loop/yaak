import { open } from '@tauri-apps/plugin-dialog';
import { gitClone } from '@yaakapp-internal/git';
import { useState } from 'react';
import { openWorkspaceFromSyncDir } from '../commands/openWorkspaceFromSyncDir';
import { appInfo } from '../lib/appInfo';
import { showErrorToast } from '../lib/toast';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Checkbox } from './core/Checkbox';
import { IconButton } from './core/IconButton';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { promptCredentials } from './git/credentials';

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
  const [hasSubdirectory, setHasSubdirectory] = useState(false);
  const [subdirectory, setSubdirectory] = useState<string>('');
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoName = extractRepoName(url);
  const sep = getPathSeparator(baseDirectory);
  const computedDirectory = repoName ? `${baseDirectory}${sep}${repoName}` : baseDirectory;
  const directory = directoryOverride ?? computedDirectory;
  const workspaceDirectory =
    hasSubdirectory && subdirectory ? `${directory}${sep}${subdirectory}` : directory;

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
      const result = await gitClone(url, directory, promptCredentials);

      if (result.type === 'needs_credentials') {
        setError(
          result.error ?? 'Authentication failed. Please check your credentials and try again.',
        );
        return;
      }

      // Open the workspace from the cloned directory (or subdirectory)
      await openWorkspaceFromSyncDir.mutateAsync(workspaceDirectory);

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

      <Checkbox
        checked={hasSubdirectory}
        onChange={setHasSubdirectory}
        title="Workspace is in a subdirectory"
        help="Enable if the Yaak workspace files are not at the root of the repository"
      />

      {hasSubdirectory && (
        <PlainInput
          label="Subdirectory"
          placeholder="path/to/workspace"
          defaultValue={subdirectory}
          onChange={setSubdirectory}
        />
      )}

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
