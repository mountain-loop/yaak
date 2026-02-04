import type { UncommittedChangesStrategy } from '@yaakapp-internal/git';
import { showConfirm } from '../../lib/confirm';

export async function promptUncommittedChangesStrategy(): Promise<UncommittedChangesStrategy> {
  const confirmed = await showConfirm({
    id: 'git-uncommitted-changes',
    title: 'Uncommitted Changes',
    description: 'You have uncommitted changes. Commit or reset your changes before pulling.',
    confirmText: 'Reset and Pull',
    color: 'danger',
  });
  return confirmed ? 'reset' : 'cancel';
}
