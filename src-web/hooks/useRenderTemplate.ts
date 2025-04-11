import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useRenderTemplate(template: string) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = useActiveEnvironment()?.id ?? null;
  return useQuery<string>({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    refetchOnWindowFocus: false,
    queryKey: ['render_template', template],
    queryFn: () => renderTemplate({ template, workspaceId, environmentId }),
  });
}

export async function renderTemplate({
  template,
  workspaceId,
  environmentId,
}: {
  template: string;
  workspaceId: string;
  environmentId: string | null;
}): Promise<string> {
  return invokeCmd('cmd_render_template', { template, workspaceId, environmentId });
}

export async function decryptTemplate({
  template,
  workspaceId,
  environmentId,
}: {
  template: string;
  workspaceId: string;
  environmentId: string | null;
}): Promise<string> {
  return invokeCmd('cmd_decrypt_template', { template, workspaceId, environmentId });
}
