import { emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { InternalEvent, ShowToastRequest } from '@yaakapp-internal/plugins';
import type { UpdateInfo, UpdateResponse, YaakNotification } from '@yaakapp-internal/tauri';
import { openSettings } from '../commands/openSettings';
import { Button } from '../components/core/Button';
import { ButtonInfiniteLoading } from '../components/core/ButtonInfiniteLoading';
import { Icon } from '../components/core/Icon';
import { HStack, VStack } from '../components/core/Stacks';

// Listen for toasts
import { listenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { updateAvailableAtom } from './atoms';
import { stringToColor } from './color';
import { generateId } from './generateId';
import { jotaiStore } from './jotai';
import { showPrompt } from './prompt';
import { invokeCmd } from './tauri';
import { showToast } from './toast';

export function initGlobalListeners() {
  listenToTauriEvent<ShowToastRequest>('show_toast', (event) => {
    showToast({ ...event.payload });
  });

  listenToTauriEvent('settings', () => openSettings.mutate(null));

  // Listen for plugin events
  listenToTauriEvent<InternalEvent>('plugin_event', async ({ payload: event }) => {
    if (event.payload.type === 'prompt_text_request') {
      const value = await showPrompt(event.payload);
      const result: InternalEvent = {
        id: generateId(),
        replyId: event.id,
        pluginName: event.pluginName,
        pluginRefId: event.pluginRefId,
        context: event.context,
        payload: {
          type: 'prompt_text_response',
          value,
        },
      };
      await emit(event.id, result);
    }
  });

  const UPDATE_TOAST_ID = 'update-info'; // Share the ID to replace the toast

  listenToTauriEvent<string>('update_installed', async ({ payload: version }) => {
    showToast({
      id: UPDATE_TOAST_ID,
      color: 'primary',
      timeout: null,
      message: (
        <VStack>
          <h2 className="font-semibold">Yaak {version} was installed</h2>
          <p className="text-text-subtle text-sm">Start using the new version now?</p>
        </VStack>
      ),
      action: ({ hide }) => (
        <ButtonInfiniteLoading
          size="xs"
          className="mr-auto min-w-[5rem]"
          color="primary"
          loadingChildren="Restarting..."
          onClick={() => {
            hide();
            setTimeout(() => invokeCmd('cmd_restart', {}), 200);
          }}
        >
          Relaunch Yaak
        </ButtonInfiniteLoading>
      ),
    });
  });

  // Listen for update events
  listenToTauriEvent<UpdateInfo>(
    'update_available',
    async ({ payload: { version, replyEventId, downloaded } }) => {
      console.log('Received update available event', { replyEventId, version, downloaded });
      jotaiStore.set(updateAvailableAtom, { version, downloaded });

      // Acknowledge the event, so we don't time out and try the fallback update logic
      await emit<UpdateResponse>(replyEventId, { type: 'ack' });

      showToast({
        id: UPDATE_TOAST_ID,
        color: 'info',
        timeout: null,
        message: (
          <VStack>
            <h2 className="font-semibold">Yaak {version} is available</h2>
            <p className="text-text-subtle text-sm">
              {downloaded ? 'Do you want to install' : 'Download and install'} the update?
            </p>
          </VStack>
        ),
        action: () => (
          <HStack space={1.5}>
            <ButtonInfiniteLoading
              size="xs"
              color="info"
              className="min-w-[10rem]"
              loadingChildren={downloaded ? 'Installing...' : 'Downloading...'}
              onClick={async () => {
                await emit<UpdateResponse>(replyEventId, { type: 'action', action: 'install' });
              }}
            >
              {downloaded ? 'Install Now' : 'Download and Install'}
            </ButtonInfiniteLoading>
            <Button
              size="xs"
              color="info"
              variant="border"
              rightSlot={<Icon icon="external_link" />}
              onClick={async () => {
                await openUrl('https://yaak.app/changelog/' + version);
              }}
            >
              What&apos;s New
            </Button>
          </HStack>
        ),
      });
    },
  );

  listenToTauriEvent<YaakNotification>('notification', ({ payload }) => {
    console.log('Got notification event', payload);
    showNotificationToast(payload);
  });
}

function showNotificationToast(n: YaakNotification) {
  const actionUrl = n.action?.url;
  const actionLabel = n.action?.label;
  showToast({
    id: n.id,
    timeout: n.timeout ?? null,
    color: stringToColor(n.color) ?? undefined,
    message: (
      <VStack>
        {n.title && <h2 className="font-semibold">{n.title}</h2>}
        <p className="text-text-subtle text-sm">{n.message}</p>
      </VStack>
    ),
    onClose: () => {
      invokeCmd('cmd_dismiss_notification', { notificationId: n.id }).catch(console.error);
    },
    action: ({ hide }) => {
      return actionLabel && actionUrl ? (
        <Button
          size="xs"
          color={stringToColor(n.color) ?? undefined}
          className="mr-auto min-w-[5rem]"
          rightSlot={<Icon icon="external_link" />}
          onClick={() => {
            hide();
            return openUrl(actionUrl);
          }}
        >
          {actionLabel}
        </Button>
      ) : null;
    },
  });
}
