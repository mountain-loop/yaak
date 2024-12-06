import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import {GitStatusEntry} from "./bindings/git";

export function useGitStatus(dir: string) {
  const status = useQuery<void, string, GitStatusEntry[]>({
    queryKey: ['git.status'],
    queryFn: () => invoke('plugin:yaak-git|status', { dir }),
  });

  return {
    status,
  } as const;
}
