import { parseTemplate } from '@yaakapp-internal/templates';
import { activeEnvironmentIdAtom } from '../hooks/useActiveEnvironment';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { invokeCmd } from './tauri';

export function analyzeTemplate(template: string): 'global_secured' | 'local_secured' | 'insecure' {
  let secureTags = 0;
  let insecureTags = 0;
  let totalTags = 0;
  for (const t of parseTemplate(template).tokens) {
    if (t.type === 'eof') continue;

    totalTags++;
    if (t.type === 'tag' && t.val.type === 'fn' && t.val.name === 'secure') {
      secureTags++;
    } else if (t.type === 'tag' && t.val.type === 'var') {
      // Variables are secure
    } else if (t.type === 'tag' && t.val.type === 'bool') {
      // Booleans are secure
    } else {
      insecureTags++;
    }
  }

  if (secureTags === 1 && totalTags === 1) {
    return 'global_secured';
  } else if (insecureTags === 0) {
    return 'local_secured';
  } else {
    return 'insecure';
  }
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

  if (analyzeTemplate(template) === 'global_secured') {
    return template;
  }

  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom) ?? 'n/a';
  const environmentId = jotaiStore.get(activeEnvironmentIdAtom) ?? null;
  return invokeCmd<string>('cmd_secure_template', { template, workspaceId, environmentId });
}
