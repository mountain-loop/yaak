import { useQuery } from '@tanstack/react-query';
import type { RenderPurpose } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useRenderTemplate({
  template,
  enabled,
  purpose,
  refreshKey,
  ignoreError,
  preservePreviousValue,
}: {
  template: string;
  enabled: boolean;
  purpose: RenderPurpose;
  refreshKey?: string | null;
  ignoreError?: boolean;
  preservePreviousValue?: boolean;
}) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = useActiveEnvironment()?.id ?? null;
  return useQuery<string>({
    refetchOnWindowFocus: false,
    enabled,
    placeholderData: preservePreviousValue ? (prev) => prev : undefined,
    queryKey: ['render_template', workspaceId, environmentId, refreshKey, purpose, ignoreError],
    queryFn: () =>
      minPromiseMillis(
        renderTemplate({ template, workspaceId, environmentId, purpose, ignoreError }),
        300,
      ),
  });
}

export async function renderTemplate({
  template,
  workspaceId,
  environmentId,
  purpose,
  ignoreError,
}: {
  template: string;
  workspaceId: string;
  environmentId: string | null;
  purpose: RenderPurpose;
  ignoreError?: boolean;
}): Promise<string> {
  return invokeCmd('cmd_render_template', {
    template,
    workspaceId,
    environmentId,
    purpose,
    ignoreError,
  });
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
