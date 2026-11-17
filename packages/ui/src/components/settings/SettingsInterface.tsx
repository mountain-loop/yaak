import type { ReactNode } from "react";
import { useState } from "react";
import { clamp } from "../../lib/clamp";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import {
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingSelectControl,
  SettingsList,
  SettingsSection,
} from "./SettingRow";
import { SettingsPage } from "./SettingsPage";
import type {
  SettingsCallbacks,
  SettingsEditorKeymap,
  SettingsInterfaceRow,
  SettingsView,
} from "./types";

const NULL_FONT_VALUE = "__NULL_FONT__";

const fontSizeOptions = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
].map((n) => ({ label: `${n}`, value: `${n}` }));

const keymaps: { value: SettingsEditorKeymap; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "vim", label: "Vim" },
  { value: "vscode", label: "VSCode" },
  { value: "emacs", label: "Emacs" },
];

export interface SettingsInterfaceProps {
  view: SettingsView;
  callbacks: SettingsCallbacks;
  /** Sections only this app has, shown first, like the client's Workspaces */
  leadingSections?: ReactNode;
  /** Sections only this app has, shown last, like the client's License */
  trailingSections?: ReactNode;
}

export function SettingsInterface({
  view,
  callbacks,
  leadingSections,
  trailingSections,
}: SettingsInterfaceProps) {
  const { app, values, fonts } = view;
  const shown = (row: SettingsInterfaceRow) => !view.hiddenInterfaceRows?.includes(row);

  return (
    <SettingsPage title="Interface" description="Tweak settings related to the user interface.">
      <SettingsList className="space-y-8">
        {leadingSections}

        <SettingsSection title="Fonts">
          <SettingRow
            title="Interface font"
            description={`Font used for ${app.name} interface controls.`}
            controlClassName="gap-1"
          >
            {fonts && (
              <SettingSelectControl
                name="uiFont"
                label="Interface font"
                selectClassName="w-72!"
                value={values.interfaceFont ?? NULL_FONT_VALUE}
                defaultValue={NULL_FONT_VALUE}
                options={[
                  { label: "System default", value: NULL_FONT_VALUE },
                  ...fonts.uiFonts.map((f) => ({ label: f, value: f })),
                  ...fonts.editorFonts.map((f) => ({ label: f, value: f })),
                ]}
                onChange={(v) =>
                  callbacks.onChange({ interfaceFont: v === NULL_FONT_VALUE ? null : v })
                }
              />
            )}
            <SettingSelectControl
              name="interfaceFontSize"
              label="Interface Font Size"
              selectClassName="w-20!"
              value={`${values.interfaceFontSize}`}
              defaultValue="14"
              options={fontSizeOptions}
              onChange={(v) => callbacks.onChange({ interfaceFontSize: Number.parseInt(v, 10) })}
            />
          </SettingRow>

          <SettingRow
            title="Editor font"
            description="Font used in request and response editors."
            controlClassName="gap-1"
          >
            {fonts && (
              <SettingSelectControl
                name="editorFont"
                label="Editor font"
                selectClassName="w-72!"
                value={values.editorFont ?? NULL_FONT_VALUE}
                defaultValue={NULL_FONT_VALUE}
                options={[
                  { label: "System default", value: NULL_FONT_VALUE },
                  ...fonts.editorFonts.map((f) => ({ label: f, value: f })),
                ]}
                onChange={(v) =>
                  callbacks.onChange({ editorFont: v === NULL_FONT_VALUE ? null : v })
                }
              />
            )}
            <SettingSelectControl
              name="editorFontSize"
              label="Editor Font Size"
              selectClassName="w-20!"
              value={`${values.editorFontSize}`}
              defaultValue="12"
              options={fontSizeOptions}
              onChange={(v) =>
                callbacks.onChange({
                  editorFontSize: clamp(Number.parseInt(v, 10) || 14, 8, 30),
                })
              }
            />
          </SettingRow>
        </SettingsSection>

        {(shown("editorKeymap") || shown("editorSoftWrap") || shown("coloredMethods")) && (
          <SettingsSection title="Editor">
            {shown("editorKeymap") && (
              <SettingRowSelect
                name="editorKeymap"
                title="Editor keymap"
                description="Keyboard shortcut preset used by text editors."
                value={values.editorKeymap}
                onChange={(editorKeymap) => callbacks.onChange({ editorKeymap })}
                options={keymaps}
              />
            )}
            {shown("editorSoftWrap") && (
              <SettingRowBoolean
                title="Wrap editor lines"
                description="Wrap long lines in request and response editors."
                checked={values.editorSoftWrap}
                onChange={(editorSoftWrap) => callbacks.onChange({ editorSoftWrap })}
              />
            )}
            {shown("coloredMethods") && (
              <SettingRowBoolean
                title="Colorize request methods"
                description="Use method-specific colors for HTTP request methods."
                checked={values.coloredMethods}
                onChange={(coloredMethods) => callbacks.onChange({ coloredMethods })}
              />
            )}
          </SettingsSection>
        )}

        {(shown("nativeTitlebar") || view.windowControlsSetting) && (
          <SettingsSection title="Window">
            {shown("nativeTitlebar") && (
              <NativeTitlebarSetting
                useNativeTitlebar={values.useNativeTitlebar}
                onApply={callbacks.onApplyNativeTitlebar}
              />
            )}
            {view.windowControlsSetting && (
              <SettingRowBoolean
                title="Hide window controls"
                description="Hide the close, maximize, and minimize controls on Windows or Linux."
                checked={values.hideWindowControls}
                onChange={(hideWindowControls) => callbacks.onChange({ hideWindowControls })}
              />
            )}
          </SettingsSection>
        )}

        {trailingSections}
      </SettingsList>
    </SettingsPage>
  );
}

function NativeTitlebarSetting({
  useNativeTitlebar,
  onApply,
}: {
  useNativeTitlebar: boolean;
  onApply: SettingsCallbacks["onApplyNativeTitlebar"];
}) {
  const [nativeTitlebar, setNativeTitlebar] = useState(useNativeTitlebar);

  return (
    <SettingRow
      title="Native title bar"
      description="Use the operating system's standard title bar and window controls."
      controlClassName="gap-2"
    >
      <Checkbox
        hideLabel
        size="md"
        checked={nativeTitlebar}
        title="Native title bar"
        onChange={setNativeTitlebar}
      />
      {useNativeTitlebar !== nativeTitlebar && (
        <Button color="primary" size="xs" onClick={() => onApply(nativeTitlebar)}>
          Apply and Restart
        </Button>
      )}
    </SettingRow>
  );
}
