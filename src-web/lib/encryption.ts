import { parseTemplate } from '@yaakapp-internal/templates';
import { activeEnvironmentIdAtom } from '../hooks/useActiveEnvironment';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { invokeCmd } from './tauri';

export function analyzeTemplateForEncryption(template: string): {
  onlySecureTag: boolean;
  containsPlainText: boolean;
} {
  let secureTags = 0;
  let plainTextTags = 0;
  let totalTags = 0;
  for (const t of parseTemplate(template).tokens) {
    if (t.type === 'eof') continue;

    totalTags++;
    if (t.type === 'tag' && t.val.type === 'fn' && t.val.name === 'secure') {
      secureTags++;
    } else if (t.type === 'tag' && t.val.type === 'var') {
      // Variables are secure
    } else {
      plainTextTags++;
    }
  }

  const onlySecureTag = secureTags === 1 && totalTags === 1;
  const containsPlainText = plainTextTags > 0;
  return { onlySecureTag, containsPlainText };
}

export async function convertTemplateToInsecure(template: string) {
  if (template === '') {
    return '';
  }

  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = jotaiStore.get(activeEnvironmentIdAtom) ?? null;
  return invokeCmd<string>('cmd_decrypt_template', { template, workspaceId, environmentId });
}

export async function convertTemplateToSecure(template: string): Promise<string> {
  if (template === '') {
    return '';
  }

  if (analyzeTemplateForEncryption(template).onlySecureTag) {
    return template;
  }

  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = jotaiStore.get(activeEnvironmentIdAtom) ?? null;
  return invokeCmd<string>('cmd_secure_template', { template, workspaceId, environmentId });
}
