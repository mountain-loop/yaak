import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { useCheckForUpdates } from "../../hooks/useCheckForUpdates";
import { appInfo } from "../../lib/appInfo";
import { revealInFinderText } from "../../lib/reveal";
import { CargoFeature } from "../CargoFeature";
import { Checkbox } from "../core/Checkbox";
import { Heading } from "../core/Heading";
import { IconButton } from "../core/IconButton";
import { KeyValueRow, KeyValueRows } from "../core/KeyValueRow";
import { PlainInput } from "../core/PlainInput";
import { Select } from "../core/Select";
import { Separator } from "../core/Separator";
import { VStack } from "../core/Stacks";

export function SettingsGeneral() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const checkForUpdates = useCheckForUpdates();

  if (settings == null || workspace == null) {
    return null;
  }

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-4">
        <Heading>Общие</Heading>
        <p className="text-text-subtle">Настройка общих параметров приложения и обновлений.</p>
      </div>
      <CargoFeature feature="updater">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
          <Select
            name="updateChannel"
            label="Канал обновлений"
            labelPosition="left"
            labelClassName="w-[14rem]"
            size="sm"
            value={settings.updateChannel}
            onChange={(updateChannel) => patchModel(settings, { updateChannel })}
            options={[
              { label: "Стабильный", value: "stable" },
              { label: "Бета (чаще)", value: "beta" },
            ]}
          />
          <IconButton
            variant="border"
            size="sm"
            title="Проверить обновления"
            icon="refresh"
            spin={checkForUpdates.isPending}
            onClick={() => checkForUpdates.mutateAsync()}
          />
        </div>

        <Select
          name="autoupdate"
          value={settings.autoupdate ? "auto" : "manual"}
          label="Поведение обновлений"
          labelPosition="left"
          size="sm"
          labelClassName="w-[14rem]"
          onChange={(v) => patchModel(settings, { autoupdate: v === "auto" })}
          options={[
            { label: "Автоматически", value: "auto" },
            { label: "Вручную", value: "manual" },
          ]}
        />
        <Checkbox
          className="pl-2 mt-1 ml-[14rem]"
          checked={settings.autoDownloadUpdates}
          disabled={!settings.autoupdate}
          help="Автоматически скачивать обновления Yaak (~50MB) в фоне, чтобы они были сразу готовы к установке."
          title="Автоматически скачивать обновления"
          onChange={(autoDownloadUpdates) => patchModel(settings, { autoDownloadUpdates })}
        />

        <Checkbox
          className="pl-2 mt-1 ml-[14rem]"
          checked={settings.checkNotifications}
          title="Проверять уведомления"
          help="Периодически обращаться к серверам Yaak для проверки важных уведомлений."
          onChange={(checkNotifications) => patchModel(settings, { checkNotifications })}
        />
        <Checkbox
          disabled
          className="pl-2 mt-1 ml-[14rem]"
          checked={false}
          title="Отправлять анонимную статистику использования"
          help="Yaak работает локально и не собирает аналитику или данные использования 🔐"
          onChange={(checkNotifications) => patchModel(settings, { checkNotifications })}
        />
      </CargoFeature>

      <Separator className="my-4" />

      <Heading level={2}>
        Workspace{" "}
        <div className="inline-block ml-1 bg-surface-highlight px-2 py-0.5 rounded text text-shrink">
          {workspace.name}
        </div>
      </Heading>
      <VStack className="mt-1 w-full" space={3}>
        <PlainInput
          required
          size="sm"
          name="requestTimeout"
          label="Таймаут запроса (мс)"
          labelClassName="w-[14rem]"
          placeholder="0"
          labelPosition="left"
          defaultValue={`${workspace.settingRequestTimeout}`}
          validate={(value) => Number.parseInt(value, 10) >= 0}
          onChange={(v) =>
            patchModel(workspace, { settingRequestTimeout: Number.parseInt(v, 10) || 0 })
          }
          type="number"
        />

        <Checkbox
          checked={workspace.settingValidateCertificates}
          help="Когда отключено, проверка сертификатов сервера пропускается; полезно для самоподписанных сертификатов."
          title="Проверять TLS-сертификаты"
          onChange={(settingValidateCertificates) =>
            patchModel(workspace, { settingValidateCertificates })
          }
        />

        <Checkbox
          checked={workspace.settingFollowRedirects}
          title="Следовать перенаправлениям"
          onChange={(settingFollowRedirects) =>
            patchModel(workspace, {
              settingFollowRedirects,
            })
          }
        />
      </VStack>

      <Separator className="my-4" />

      <Heading level={2}>App Info</Heading>
      <KeyValueRows>
        <KeyValueRow label="Версия">{appInfo.version}</KeyValueRow>
        <KeyValueRow
          label="Каталог данных"
          rightSlot={
            <IconButton
              title={revealInFinderText}
              icon="folder_open"
              size="2xs"
              onClick={() => revealItemInDir(appInfo.appDataDir)}
            />
          }
        >
          {appInfo.appDataDir}
        </KeyValueRow>
        <KeyValueRow
          label="Каталог логов"
          rightSlot={
            <IconButton
              title={revealInFinderText}
              icon="folder_open"
              size="2xs"
              onClick={() => revealItemInDir(appInfo.appLogDir)}
            />
          }
        >
          {appInfo.appLogDir}
        </KeyValueRow>
      </KeyValueRows>
    </VStack>
  );
}
