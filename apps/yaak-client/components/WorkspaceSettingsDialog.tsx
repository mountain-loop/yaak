import type { WorkspaceMeta } from "@yaakapp-internal/models";
import {
  mergeModelsInStore,
  patchModel,
  workspaceMetasAtom,
  workspacesAtom,
} from "@yaakapp-internal/models";
import { Banner, HStack, InlineCode, CountBadge } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useAuthTab } from "../hooks/useAuthTab";
import { useHeadersTab } from "../hooks/useHeadersTab";
import { useInheritedHeaders } from "../hooks/useInheritedHeaders";
import { deleteModelWithConfirm } from "../lib/deleteModelWithConfirm";
import { showDialog } from "../lib/dialog";
import { router } from "../lib/router";
import { rpc } from "../lib/rpc";
import { CopyIconButton } from "./CopyIconButton";
import { Button } from "./core/Button";
import { PlainInput } from "./core/PlainInput";
import { SettingsList, SettingsSection } from "./core/SettingRow";
import { TabContent, Tabs } from "./core/Tabs/Tabs";
import { DnsOverridesEditor } from "./DnsOverridesEditor";
import { HeadersEditor } from "./HeadersEditor";
import { HttpAuthenticationEditor } from "./HttpAuthenticationEditor";
import { MarkdownEditor } from "./MarkdownEditor";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { SyncToFilesystemSetting } from "./SyncToFilesystemSetting";
import { WorkspaceEncryptionSetting } from "./WorkspaceEncryptionSetting";

interface Props {
  workspaceId: string;
  hide: () => void;
  tab?: WorkspaceSettingsTab;
}

const TAB_AUTH = "auth";
const TAB_DNS = "dns";
const TAB_HEADERS = "headers";
const TAB_GENERAL = "general";
const TAB_SETTINGS = "settings";

export type WorkspaceSettingsTab =
  | typeof TAB_AUTH
  | typeof TAB_DNS
  | typeof TAB_HEADERS
  | typeof TAB_GENERAL
  | typeof TAB_SETTINGS;

const DEFAULT_TAB: WorkspaceSettingsTab = TAB_GENERAL;

export function WorkspaceSettingsDialog({ workspaceId, hide, tab }: Props) {
  const workspace = useAtomValue(workspacesAtom).find((w) => w.id === workspaceId);
  const workspaceMeta = useAtomValue(workspaceMetasAtom).find((m) => m.workspaceId === workspaceId);
  const authTab = useAuthTab(TAB_AUTH, workspace ?? null);
  const headersTab = useHeadersTab(TAB_HEADERS, workspace ?? null);
  const inheritedHeaders = useInheritedHeaders(workspace ?? null);
  const workspaceMetaError = useEnsureWorkspaceMeta(
    workspaceId,
    workspace != null && workspaceMeta == null,
  );

  if (workspace == null) {
    return (
      <Banner color="danger">
        <InlineCode>Workspace</InlineCode> not found
      </Banner>
    );
  }

  return (
    <Tabs
      defaultValue={tab ?? DEFAULT_TAB}
      label="Folder Settings"
      className="pt-4 pb-2 px-3"
      tabListClassName="pl-4"
      addBorders
      tabs={[
        { value: TAB_GENERAL, label: "Workspace" },
        {
          value: TAB_SETTINGS,
          label: "Settings",
        },
        ...headersTab,
        ...authTab,
        {
          value: TAB_DNS,
          label: "DNS",
          rightSlot:
            workspace.settingDnsOverrides.length > 0 ? (
              <CountBadge count={workspace.settingDnsOverrides.length} />
            ) : null,
        },
      ]}
      storageKey="workspace_settings_tabs"
    >
      <TabContent value={TAB_AUTH} className="overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={workspace} />
      </TabContent>
      <TabContent value={TAB_HEADERS} className="overflow-y-auto h-full px-4">
        <HeadersEditor
          inheritedHeaders={inheritedHeaders}
          inheritedHeadersLabel="Defaults"
          forceUpdateKey={workspace.id}
          headers={workspace.headers}
          onChange={(headers) => patchModel(workspace, { headers })}
          stateKey={`headers.${workspace.id}`}
        />
      </TabContent>
      <TabContent value={TAB_SETTINGS} className="overflow-y-auto h-full px-4">
        <SettingsList className="space-y-8 pb-3">
          <SettingsSection title={null}>
            {workspaceMeta != null ? (
              <>
                <SyncToFilesystemSetting
                  layout="settings"
                  value={{ filePath: workspaceMeta.settingSyncDir }}
                  onCreateNewWorkspace={hide}
                  onChange={({ filePath }) =>
                    patchModel(workspaceMeta, { settingSyncDir: filePath })
                  }
                />
                <div className="mt-4">
                  <WorkspaceEncryptionSetting layout="settings" size="xs" />
                </div>
              </>
            ) : workspaceMetaError != null ? (
              <Banner color="danger">
                Sync and encryption settings are unavailable because{" "}
                <InlineCode>WorkspaceMeta</InlineCode> could not be loaded: {workspaceMetaError}
              </Banner>
            ) : null}
          </SettingsSection>
          <ModelSettingsEditor model={workspace} showSectionTitles />
        </SettingsList>
      </TabContent>
      <TabContent value={TAB_GENERAL} className="overflow-y-auto h-full px-4">
        <div className="grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4 pb-3 h-full">
          <PlainInput
            required
            hideLabel
            placeholder="Workspace Name"
            label="Name"
            defaultValue={workspace.name}
            className="text-base! font-sans"
            onChange={(name) => patchModel(workspace, { name })}
          />

          <MarkdownEditor
            name="workspace-description"
            placeholder="Workspace description"
            className="border border-border px-2"
            defaultValue={workspace.description}
            stateKey={`description.${workspace.id}`}
            onChange={(description) => patchModel(workspace, { description })}
            heightMode="auto"
          />

          <HStack alignItems="center" justifyContent="between" className="w-full">
            <Button
              onClick={async () => {
                const didDelete = await deleteModelWithConfirm(workspace, {
                  confirmName: workspace.name,
                });
                if (didDelete) {
                  hide(); // Only hide if actually deleted workspace
                  await router.navigate({ to: "/" });
                }
              }}
              color="danger"
              variant="border"
              size="xs"
            >
              Delete Workspace
            </Button>
            <InlineCode className="flex gap-1 items-center text-primary pl-2.5">
              {workspaceId}
              <CopyIconButton
                className="opacity-70 text-primary!"
                size="2xs"
                iconSize="sm"
                title="Copy workspace ID"
                text={workspaceId}
              />
            </InlineCode>
          </HStack>
        </div>
      </TabContent>
      <TabContent value={TAB_DNS} className="overflow-y-auto h-full px-4">
        <DnsOverridesEditor workspace={workspace} />
      </TabContent>
    </Tabs>
  );
}

/**
 * The meta row normally reaches the store when the workspace loads, which also creates it if it
 * is missing. If that load failed (for example on a corrupt row elsewhere in the workspace), the
 * store never gets it, so ask for it directly. Returns the error if that fails too.
 */
function useEnsureWorkspaceMeta(workspaceId: string, missing: boolean): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    setError(null);
    rpc<WorkspaceMeta>("cmd_get_workspace_meta", { workspaceId }).then(
      (meta) => {
        if (!cancelled) mergeModelsInStore("workspace_meta", [meta]);
      },
      (err) => {
        if (!cancelled) setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, missing]);

  return error;
}

WorkspaceSettingsDialog.show = (workspaceId: string, tab?: WorkspaceSettingsTab) => {
  showDialog({
    id: "workspace-settings",
    size: "lg",
    className: "h-[calc(100vh-5rem)] max-h-200!",
    noPadding: true,
    render: ({ hide }) => (
      <WorkspaceSettingsDialog workspaceId={workspaceId} hide={hide} tab={tab} />
    ),
  });
};
