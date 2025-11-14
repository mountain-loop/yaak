import { useQuery } from '@tanstack/react-query';
import type { RenderPurpose } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export type RenderTemplateBehavior =
  | { type: 'live' }
  | { type: 'never' }
  | { type: 'key_change'; key: string | null };

export function useRenderTemplate(
  template: string,
  behavior: RenderTemplateBehavior = { type: 'live' },
) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = useActiveEnvironment()?.id ?? null;
  const disabled =
    behavior.type === 'never' || (behavior.type === 'key_change' && behavior.key == null);

  let refreshKey: string = 'none';
  if (behavior.type === 'key_change') refreshKey = behavior.key ?? 'none';
  else if (behavior.type === 'live') refreshKey = template;

  const purpose = behavior.type === 'key_change' ? 'send' : 'preview';
  return useQuery<string>({
    refetchOnWindowFocus: false,
    enabled: !disabled,
    queryKey: ['render_template', workspaceId, environmentId, refreshKey, purpose],
    queryFn: () =>
      minPromiseMillis(renderTemplate({ template, workspaceId, environmentId, purpose }), 200),
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
