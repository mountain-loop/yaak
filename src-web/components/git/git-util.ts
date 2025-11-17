import type { PullResult, PushResult } from '@yaakapp-internal/git';
import { showToast } from '../../lib/toast';

export function handlePushResult(r: PushResult) {
  switch (r.type) {
    case 'needs_credentials':
      showToast({ id: 'push-error', message: 'Credentials not found', color: 'danger' });
      break;
    case 'success':
      showToast({ id: 'push-success', message: r.message, color: 'success' });
      break;
    case 'up_to_date':
      showToast({ id: 'push-nothing', message: 'Already up-to-date', color: 'info' });
      break;
  }
}

export function handlePullResult(r: PullResult) {
  switch (r.type) {
    case 'needs_credentials':
      showToast({ id: 'pull-error', message: 'Credentials not found', color: 'danger' });
      break;
    case 'success':
      showToast({ id: 'pull-success', message: r.message, color: 'success' });
      break;
    case 'up_to_date':
      showToast({ id: 'pull-nothing', message: 'Already up-to-date', color: 'info' });
      break;
  }
}
