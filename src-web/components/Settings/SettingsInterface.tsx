import { getOsType } from "../../lib/os";
import { useFonts } from "@yaakapp-internal/fonts";
import { useLicense } from "@yaakapp-internal/license";
import type { EditorKeymap, Settings } from "@yaakapp-internal/models";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { clamp } from "../../lib/clamp";
import { showConfirm } from "../../lib/confirm";
import { invokeCmd } from "../../lib/tauri";
import { CargoFeature } from "../CargoFeature";
import { Button } from "../core/Button";
import { Checkbox } from "../core/Checkbox";
import { Heading } from "../core/Heading";
import { Icon } from "../core/Icon";
import { Link } from "../core/Link";
import { Select } from "../core/Select";
import { HStack, VStack } from "../core/Stacks";

const NULL_FONT_VALUE = "__NULL_FONT__";

const fontSizeOptions = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
].map((n) => ({ label: `${n}`, value: `${n}` }));

const keymaps: { value: EditorKeymap; label: string }[] = [
  { value: "default", label: "По умолчанию" },
  { value: "vim", label: "Vim" },
  { value: "vscode", label: "VSCode" },
  { value: "emacs", label: "Emacs" },
];

export function SettingsInterface() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const fonts = useFonts();

  if (settings == null || workspace == null) {
    return null;
  }

  return (
    <VStack space={3} className="mb-4">
      <div className="mb-3">
        <Heading>Интерфейс</Heading>
        <p className="text-text-subtle">Настройка параметров пользовательского интерфейса.</p>
      </div>
      <Select
        name="switchWorkspaceBehavior"
        label="Поведение открытия рабочего пространства"
        size="sm"
        help="При открытии рабочего пространства использовать текущее окно или новое?"
        value={
          settings.openWorkspaceNewWindow === true
            ? "new"
            : settings.openWorkspaceNewWindow === false
              ? "current"
              : "ask"
        }
        onChange={async (v) => {
          if (v === "current") await patchModel(settings, { openWorkspaceNewWindow: false });
          else if (v === "new") await patchModel(settings, { openWorkspaceNewWindow: true });
          else await patchModel(settings, { openWorkspaceNewWindow: null });
        }}
        options={[
          { label: "Всегда спрашивать", value: "ask" },
          { label: "Открывать в текущем окне", value: "current" },
          { label: "Открывать в новом окне", value: "new" },
        ]}
      />
      <HStack space={2} alignItems="end">
        {fonts.data && (
          <Select
            size="sm"
            name="uiFont"
            label="Шрифт интерфейса"
            value={settings.interfaceFont ?? NULL_FONT_VALUE}
            options={[
              { label: "Системный по умолчанию", value: NULL_FONT_VALUE },
              ...(fonts.data.uiFonts.map((f) => ({
                label: f,
                value: f,
              })) ?? []),
              // Some people like monospace fonts for the UI
              ...(fonts.data.editorFonts.map((f) => ({
                label: f,
                value: f,
              })) ?? []),
            ]}
            onChange={async (v) => {
              const interfaceFont = v === NULL_FONT_VALUE ? null : v;
              await patchModel(settings, { interfaceFont });
            }}
          />
        )}
        <Select
          hideLabel
          size="sm"
          name="interfaceFontSize"
          label="Размер шрифта интерфейса"
          defaultValue="14"
          value={`${settings.interfaceFontSize}`}
          options={fontSizeOptions}
          onChange={(v) => patchModel(settings, { interfaceFontSize: Number.parseInt(v, 10) })}
        />
      </HStack>
      <HStack space={2} alignItems="end">
        {fonts.data && (
          <Select
            size="sm"
            name="editorFont"
            label="Шрифт редактора"
            value={settings.editorFont ?? NULL_FONT_VALUE}
            options={[
              { label: "Системный по умолчанию", value: NULL_FONT_VALUE },
              ...(fonts.data.editorFonts.map((f) => ({
                label: f,
                value: f,
              })) ?? []),
            ]}
            onChange={async (v) => {
              const editorFont = v === NULL_FONT_VALUE ? null : v;
              await patchModel(settings, { editorFont });
            }}
          />
        )}
        <Select
          hideLabel
          size="sm"
          name="editorFontSize"
          label="Размер шрифта редактора"
          defaultValue="12"
          value={`${settings.editorFontSize}`}
          options={fontSizeOptions}
          onChange={(v) =>
            patchModel(settings, { editorFontSize: clamp(Number.parseInt(v, 10) || 14, 8, 30) })
          }
        />
      </HStack>
      <Select
        leftSlot={<Icon icon="keyboard" color="secondary" />}
        size="sm"
        name="editorKeymap"
        label="Раскладка клавиш редактора"
        value={`${settings.editorKeymap}`}
        options={keymaps}
        onChange={(v) => patchModel(settings, { editorKeymap: v })}
      />
      <Checkbox
        checked={settings.editorSoftWrap}
        title="Переносить строки редактора"
        onChange={(editorSoftWrap) => patchModel(settings, { editorSoftWrap })}
      />
      <Checkbox
        checked={settings.coloredMethods}
        title="Подсвечивать методы запросов"
        onChange={(coloredMethods) => patchModel(settings, { coloredMethods })}
      />
      <CargoFeature feature="license">
        <LicenseSettings settings={settings} />
      </CargoFeature>

      <NativeTitlebarSetting settings={settings} />

      {getOsType() !== "macos" && (
        <Checkbox
          checked={settings.hideWindowControls}
          title="Скрыть элементы управления окном"
          help="Скрыть кнопки закрытия/разворачивания/сворачивания в Windows или Linux"
          onChange={(hideWindowControls) => patchModel(settings, { hideWindowControls })}
        />
      )}
    </VStack>
  );
}

function NativeTitlebarSetting({ settings }: { settings: Settings }) {
  const [nativeTitlebar, setNativeTitlebar] = useState(settings.useNativeTitlebar);
  return (
    <div className="flex gap-1 overflow-hidden h-2xs">
      <Checkbox
        checked={nativeTitlebar}
        title="Системная строка заголовка"
        help="Использовать стандартную строку заголовка и элементы управления окна ОС"
        onChange={setNativeTitlebar}
      />
      {settings.useNativeTitlebar !== nativeTitlebar && (
        <Button
          color="primary"
          size="2xs"
          onClick={async () => {
            await patchModel(settings, { useNativeTitlebar: nativeTitlebar });
            await invokeCmd("cmd_restart");
          }}
        >
          Apply and Restart
        </Button>
      )}
    </div>
  );
}

function LicenseSettings({ settings }: { settings: Settings }) {
  const license = useLicense();
  if (license.check.data?.status !== "personal_use") {
    return null;
  }

  return (
    <Checkbox
      checked={settings.hideLicenseBadge}
      title="Скрыть бейдж личного использования"
      onChange={async (hideLicenseBadge) => {
        if (hideLicenseBadge) {
          const confirmed = await showConfirm({
            id: "hide-license-badge",
            title: "Подтвердить личное использование",
            confirmText: "Подтвердить",
            description: (
              <VStack space={3}>
                <p>Hey there 👋🏼</p>
                <p>
                  Yaak is free for personal projects and learning.{" "}
                  <strong>If you’re using Yaak at work, a license is required.</strong>
                </p>
                <p>
                  Licenses help keep Yaak independent and sustainable.{" "}
                  <Link href="https://yaak.app/pricing?s=badge">Purchase a License →</Link>
                </p>
              </VStack>
            ),
            requireTyping: "Личное использование",
            color: "info",
          });
          if (!confirmed) {
            return; // Cancel
          }
        }
        await patchModel(settings, { hideLicenseBadge });
      }}
    />
  );
}
