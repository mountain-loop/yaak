import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useRenderTemplate(template: string) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = useActiveEnvironment()?.id ?? null;
  return useQuery<string>({
    refetchOnWindowFocus: false,
    queryKey: ['render_template', template, workspaceId, environmentId],
    queryFn: () => minPromiseMillis(renderTemplate({ template, workspaceId, environmentId }), 200),
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
