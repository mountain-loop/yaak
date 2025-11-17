import type { PushResult } from '@yaakapp-internal/git';
import { showToast } from '../../lib/toast';

export function handlePushResult(r: PushResult) {
  switch (r.type) {
    case 'needs_credentials':
      showToast({ id: 'push-error', message: 'Credentials not found', color: 'danger' });
      break;
    case 'success':
      showToast({ id: 'push-success', message: r.message, color: 'success' });
      break;
    case 'nothing_to_push':
      showToast({ id: 'push-nothing', message: 'Nothing to push', color: 'info' });
      break;
  }
}
