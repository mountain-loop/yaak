import type { GitRemote } from '@yaakapp-internal/git';
import { gitMutations } from '@yaakapp-internal/git';
import { showPromptForm } from '../../lib/prompt-form';
import { gitCallbacks } from './callbacks';

export async function addGitRemote(dir: string): Promise<GitRemote> {
  const r = await showPromptForm({
    id: 'add-remote',
    title: 'Add Remote',
    inputs: [
      { type: 'text', label: 'Name', name: 'name' },
      { type: 'text', label: 'URL', name: 'url' },
    ],
  });
  if (r == null) throw new Error('Cancelled remote prompt');

  const name = String(r.name ?? '');
  const url = String(r.url ?? '');
  return gitMutations(dir, gitCallbacks(dir)).addRemote.mutateAsync({ name, url });
}
