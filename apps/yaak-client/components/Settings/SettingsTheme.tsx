import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { Heading, HStack, Icon, type IconProps, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { lazy, Suspense } from "react";
import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { useResolvedAppearance } from "../../hooks/useResolvedAppearance";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { ButtonProps } from "../core/Button";
import { IconButton } from "../core/IconButton";
import { Link } from "../core/Link";
import type { SelectProps } from "../core/Select";
import {
  ModelSettingRowSelect,
  SettingRowSelect,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const Editor = lazy(() => import("../core/Editor/Editor").then((m) => ({ default: m.Editor })));

const buttonColors: ButtonProps["color"][] = [
  "primary",
  "info",
  "success",
  "notice",
  "warning",
  "danger",
  "secondary",
  "default",
];

const icons: IconProps["icon"][] = [
  "info",
  "box",
  "update",
  "alert_triangle",
  "arrow_big_right_dash",
  "download",
  "copy",
  "magic_wand",
  "settings",
  "trash",
  "sparkles",
  "pencil",
  "paste",
  "search",
  "send_horizontal",
];

export function SettingsTheme() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const appearance = useResolvedAppearance();
  const activeTheme = useResolvedTheme();

  if (settings == null || workspace == null || activeTheme.data == null) {
    return null;
  }

  const lightThemes: SelectProps<string>["options"] = activeTheme.data.themes
    .filter((theme) => !theme.dark)
    .map((theme) => ({
      label: theme.label,
      value: theme.id,
    }));

  const darkThemes: SelectProps<string>["options"] = activeTheme.data.themes
    .filter((theme) => theme.dark)
    .map((theme) => ({
      label: theme.label,
      value: theme.id,
    }));

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>Theme</Heading>
        <p className="text-text-subtle">
          Make Yaak your own by selecting a theme, or{" "}
          <Link href="https://yaak.app/docs/plugin-development/plugins-quick-start">
            Create Your Own
          </Link>
        </p>
      </div>
      <SettingsList className="space-y-8">
        <SettingsSection title="Theme">
          <ModelSettingRowSelect
            model={settings}
            modelKey="appearance"
            title="Appearance"
            description="Choose whether Yaak follows your system appearance or uses a fixed mode."
            options={[
              { label: "Automatic", value: "system" },
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
            ]}
          />
          {(settings.appearance === "system" || settings.appearance === "light") && (
            <SettingRowSelect
              name="lightTheme"
              title="Light theme"
              description="Theme used when Yaak is in light mode."
              value={activeTheme.data.light.id}
              options={lightThemes}
              onChange={(themeLight) => patchModel(settings, { themeLight })}
            />
          )}
          {(settings.appearance === "system" || settings.appearance === "dark") && (
            <SettingRowSelect
              name="darkTheme"
              title="Dark theme"
              description="Theme used when Yaak is in dark mode."
              value={activeTheme.data.dark.id}
              options={darkThemes}
              onChange={(themeDark) => patchModel(settings, { themeDark })}
            />
          )}
        </SettingsSection>

        <SettingsSection title="Preview">
          <VStack
            space={3}
            className="mt-4 w-full bg-surface p-3 border border-dashed border-border-subtle rounded overflow-x-auto"
          >
            <HStack className="text" space={1.5}>
              <Icon icon={appearance === "dark" ? "moon" : "sun"} />
              <strong>{activeTheme.data.active.label}</strong>
              <em>(preview)</em>
            </HStack>
            <HStack space={1.5} className="w-full">
              {buttonColors.map((c, i) => (
                <IconButton
                  key={c}
                  color={c}
                  size="2xs"
                  iconSize="xs"
                  icon={icons[i % icons.length] ?? "info"}
                  iconClassName="text"
                  title={`${c}`}
                />
              ))}
              {buttonColors.map((c, i) => (
                <IconButton
                  key={c}
                  color={c}
                  variant="border"
                  size="2xs"
                  iconSize="xs"
                  icon={icons[i % icons.length] ?? "info"}
                  iconClassName="text"
                  title={`${c}`}
                />
              ))}
            </HStack>
            <Suspense>
              <Editor
                defaultValue={[
                  "let foo = { // Demo code editor",
                  '  foo: ("bar" || "baz" ?? \'qux\'),',
                  "  baz: [1, 10.2, null, false, true],",
                  "};",
                ].join("\n")}
                heightMode="auto"
                language="javascript"
                stateKey={null}
              />
            </Suspense>
          </VStack>
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}
