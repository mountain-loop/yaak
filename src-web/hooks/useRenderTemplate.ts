import { useQuery } from '@tanstack/react-query';
import type { RenderPurpose } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useRenderTemplate(
  template: string,
  enabled: boolean,
  purpose: RenderPurpose,
  refreshKey: string | null,
) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = useActiveEnvironment()?.id ?? null;
  return useQuery<string>({
    refetchOnWindowFocus: false,
    enabled,
    queryKey: ['render_template', workspaceId, environmentId, refreshKey, purpose],
    queryFn: () =>
      minPromiseMillis(renderTemplate({ template, workspaceId, environmentId, purpose }), 300),
  });
}

export async function renderTemplate({
  template,
  workspaceId,
  environmentId,
  purpose,
}: {
  template: string;
  workspaceId: string;
  environmentId: string | null;
  purpose: RenderPurpose;
}): Promise<string> {
  return invokeCmd('cmd_render_template', { template, workspaceId, environmentId, purpose });
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
