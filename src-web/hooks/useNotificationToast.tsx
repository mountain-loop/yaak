import { open } from '@tauri-apps/plugin-shell';
import { Button } from '../components/core/Button';
import { invokeCmd } from '../lib/tauri';
import { useListenToTauriEvent } from './useListenToTauriEvent';
import { useToast } from './useToast';

export function useNotificationToast() {
  const toast = useToast();

  const markRead = (id: string) => {
    invokeCmd('cmd_dismiss_notification', { notificationId: id }).catch(console.error);
  };

  useListenToTauriEvent<{
    id: string;
    timestamp: string;
    message: string;
    action?: null | {
      url: string;
      label: string;
    };
  }>('notification', ({ payload }) => {
    console.log('Got notification event', payload);
    const actionUrl = payload.action?.url;
    const actionLabel = payload.action?.label;
    toast.show({
      id: payload.id,
      timeout: null,
      message: payload.message,
      color: 'custom',
      onClose: () => markRead(payload.id),
      action: ({ hide }) =>
        actionLabel && actionUrl ? (
          <Button
            size="xs"
            color="secondary"
            className="mr-auto min-w-[5rem]"
            onClick={() => {
              hide();
              return open(actionUrl);
            }}
          >
            {actionLabel}
          </Button>
        ) : null,
    });
  });
}
