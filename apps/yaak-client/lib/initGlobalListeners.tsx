import { debounce } from "@yaakapp-internal/lib";
import type {
  FormInput,
  InternalEvent,
  JsonPrimitive,
  ShowToastRequest,
} from "@yaakapp-internal/plugins";
import { updateAllPlugins } from "@yaakapp-internal/plugins";
import type {
  PluginUpdateNotification,
  UpdateInfo,
  UpdateResponse,
  YaakNotification,
} from "@yaakapp-internal/tauri-client";
import { HStack, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { openSettings } from "../commands/openSettings";
import { Button } from "../components/core/Button";
import { ButtonInfiniteLoading } from "../components/core/ButtonInfiniteLoading";

// Listen for toasts
import { platform } from "@yaakapp-internal/platform";
import { updateAvailableAtom } from "./atoms";
import { stringToColor } from "./color";
import { generateId } from "./generateId";
import { jotaiStore } from "./jotai";
import { showPrompt } from "./prompt";
import { showPromptForm } from "./prompt-form";
import { rpc } from "./rpc";
import { showToast } from "./toast";

export function initGlobalListeners() {
  platform.listen<ShowToastRequest>("show_toast", (payload) => {
    showToast({ ...payload });
  });

  // Show errors for any plugins that failed to load during startup
  void rpc<[string, string][]>("cmd_plugin_init_errors").then((errors) => {
    for (const [dir, err] of errors) {
      const name = dir.split(/[/\\]/).pop() ?? dir;
      showToast({
        id: `plugin-init-error-${name}`,
        color: "danger",
        timeout: null,
        message: `Failed to load plugin "${name}": ${err}`,
        action: ({ hide }) => (
          <Button
            size="xs"
            color="danger"
            variant="border"
            onClick={() => {
              hide();
              openSettings.mutate("plugins:installed");
            }}
          >
            Manage Plugins
          </Button>
        ),
      });
    }
  });

  platform.listen("settings", () => openSettings.mutate(null));

  // Track active dynamic form dialogs so follow-up input updates can reach them
  const activeForms = new Map<string, (inputs: FormInput[]) => void>();

  // Listen for plugin events
  platform.listen<InternalEvent>("plugin_event", async (event) => {
    if (event.payload.type === "prompt_text_request") {
      const value = await showPrompt(event.payload);
      const result: InternalEvent = {
        id: generateId(),
        replyId: event.id,
        pluginName: event.pluginName,
        pluginRefId: event.pluginRefId,
        context: event.context,
        payload: {
          type: "prompt_text_response",
          value,
        },
      };
      await platform.emit(event.id, result);
    } else if (event.payload.type === "prompt_form_request") {
      if (event.replyId != null) {
        // Follow-up update from plugin runtime — update the active dialog's inputs
        const updateInputs = activeForms.get(event.replyId);
        if (updateInputs) {
          updateInputs(event.payload.inputs);
        }
        return;
      }

      // Initial request — show the dialog with bidirectional support
      const emitFormResponse = (values: Record<string, JsonPrimitive> | null, done: boolean) => {
        const result: InternalEvent = {
          id: generateId(),
          replyId: event.id,
          pluginName: event.pluginName,
          pluginRefId: event.pluginRefId,
          context: event.context,
          payload: {
            type: "prompt_form_response",
            values,
            done,
          },
        };
        void platform.emit(event.id, result);
      };

      const values = await showPromptForm({
        id: event.payload.id,
        title: event.payload.title,
        description: event.payload.description,
        size: event.payload.size,
        inputs: event.payload.inputs,
        confirmText: event.payload.confirmText,
        cancelText: event.payload.cancelText,
        onValuesChange: debounce((values) => emitFormResponse(values, false), 150),
        onInputsUpdated: (cb) => activeForms.set(event.id, cb),
      });

      // Clean up and send final response
      activeForms.delete(event.id);
      emitFormResponse(values, true);
    }
  });

  platform.listen<string>("update_installed", async (version) => {
    console.log("Got update installed event", version);
    showUpdateInstalledToast(version);
  });

  // Listen for update events
  platform.listen<UpdateInfo>("update_available", async (payload) => {
    console.log("Got update available", payload);
    void showUpdateAvailableToast(payload);
  });

  platform.listen<YaakNotification>("notification", (payload) => {
    console.log("Got notification event", payload);
    showNotificationToast(payload);
  });

  // Listen for plugin update events
  platform.listen<PluginUpdateNotification>("plugin_updates_available", (payload) => {
    console.log("Got plugin updates event", payload);
    showPluginUpdatesToast(payload);
  });
}

function showUpdateInstalledToast(version: string) {
  const UPDATE_TOAST_ID = "update-info";

  showToast({
    id: UPDATE_TOAST_ID,
    color: "primary",
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
        className="mr-auto min-w-20"
        color="primary"
        loadingChildren="Restarting..."
        onClick={() => {
          hide();
          setTimeout(() => rpc("cmd_restart", {}), 200);
        }}
      >
        Relaunch Yaak
      </ButtonInfiniteLoading>
    ),
  });
}

async function showUpdateAvailableToast(updateInfo: UpdateInfo) {
  const UPDATE_TOAST_ID = "update-info";
  const { version, replyEventId, downloaded, install } = updateInfo;

  jotaiStore.set(updateAvailableAtom, { version, downloaded, install });

  const whatsNewButton = (
    <Button
      size="xs"
      color="info"
      variant="border"
      rightSlot={<Icon icon="external_link" />}
      onClick={async () => {
        await platform.openUrl(`https://yaak.app/changelog/${version}`);
      }}
    >
      What&apos;s New
    </Button>
  );

  if (install !== "integrated") {
    // Nothing to reply to here; the backend only told us so we can say how to update
    const flatpak = install === "flatpak";
    showToast({
      id: UPDATE_TOAST_ID,
      color: "info",
      timeout: null,
      message: (
        <VStack>
          <h2 className="font-semibold">Yaak {version} is available</h2>
          <p className="text-text-subtle text-sm">
            {flatpak ? (
              <>
                Update with <InlineCode>flatpak update</InlineCode> or your software center.
              </>
            ) : (
              "Download the new version to upgrade."
            )}
          </p>
        </VStack>
      ),
      action: () => (
        <HStack space={1.5}>
          {!flatpak && (
            <Button
              size="xs"
              color="info"
              rightSlot={<Icon icon="external_link" />}
              onClick={async () => {
                await platform.openUrl("https://yaak.app/download");
              }}
            >
              Download
            </Button>
          )}
          {whatsNewButton}
        </HStack>
      ),
    });
    return;
  }

  // Acknowledge the event, so we don't time out and try the fallback update logic
  await platform.emit(replyEventId, { type: "ack" } satisfies UpdateResponse);

  showToast({
    id: UPDATE_TOAST_ID,
    color: "info",
    timeout: null,
    message: (
      <VStack>
        <h2 className="font-semibold">Yaak {version} is available</h2>
        <p className="text-text-subtle text-sm">
          {downloaded ? "Do you want to install" : "Download and install"} the update?
        </p>
      </VStack>
    ),
    action: () => (
      <HStack space={1.5}>
        <ButtonInfiniteLoading
          size="xs"
          color="info"
          className="min-w-40"
          loadingChildren={downloaded ? "Installing..." : "Downloading..."}
          onClick={async () => {
            await platform.emit(replyEventId, {
              type: "action",
              action: "install",
            } satisfies UpdateResponse);
          }}
        >
          {downloaded ? "Install Now" : "Download and Install"}
        </ButtonInfiniteLoading>
        {whatsNewButton}
      </HStack>
    ),
  });
}

function showPluginUpdatesToast(updateInfo: PluginUpdateNotification) {
  const PLUGIN_UPDATE_TOAST_ID = "plugin-updates";
  const count = updateInfo.updateCount;
  const pluginNames = updateInfo.plugins.map((p: { name: string }) => p.name);

  showToast({
    id: PLUGIN_UPDATE_TOAST_ID,
    color: "info",
    timeout: null,
    message: (
      <VStack>
        <h2 className="font-semibold">
          {count === 1 ? "1 plugin update" : `${count} plugin updates`} available
        </h2>
        <p className="text-text-subtle text-sm">
          {count === 1
            ? pluginNames[0]
            : `${pluginNames.slice(0, 2).join(", ")}${count > 2 ? `, and ${count - 2} more` : ""}`}
        </p>
      </VStack>
    ),
    action: ({ hide }) => (
      <HStack space={1.5}>
        <ButtonInfiniteLoading
          size="xs"
          color="info"
          className="min-w-20"
          loadingChildren="Updating..."
          onClick={async () => {
            const updated = await updateAllPlugins();
            hide();
            if (updated.length > 0) {
              showToast({
                color: "success",
                message: `Successfully updated ${updated.length} plugin${updated.length === 1 ? "" : "s"}`,
              });
            }
          }}
        >
          Update All
        </ButtonInfiniteLoading>
        <Button
          size="xs"
          color="info"
          variant="border"
          onClick={() => {
            hide();
            openSettings.mutate("plugins:installed");
          }}
        >
          View Updates
        </Button>
      </HStack>
    ),
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
      rpc("cmd_dismiss_notification", { notificationId: n.id }).catch(console.error);
    },
    action: ({ hide }) => {
      return actionLabel && actionUrl ? (
        <Button
          size="xs"
          color={stringToColor(n.color) ?? undefined}
          className="mr-auto min-w-20"
          rightSlot={<Icon icon="external_link" />}
          onClick={() => {
            hide();
            return platform.openUrl(actionUrl);
          }}
        >
          {actionLabel}
        </Button>
      ) : null;
    },
  });
}
