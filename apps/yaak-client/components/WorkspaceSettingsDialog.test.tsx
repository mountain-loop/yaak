// @vitest-environment happy-dom
import type { Workspace, WorkspaceMeta } from "@yaakapp-internal/models";
import { workspaceMetasAtom } from "@yaakapp-internal/models";
import { getDefaultStore, type PrimitiveAtom } from "jotai";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { WorkspaceSettingsDialog } from "./WorkspaceSettingsDialog";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(cmd: string, payload: unknown) => Promise<unknown>>(),
  mergeModelsInStore: vi.fn(),
  deleteModelWithConfirm: vi.fn<(model: unknown) => Promise<boolean>>(),
  workspace: {
    id: "wk_test",
    model: "workspace",
    name: "Broken",
    settingDnsOverrides: [],
  } as unknown as Workspace,
  workspaceMeta: {
    id: "wm_test",
    model: "workspace_meta",
    workspaceId: "wk_test",
    settingSyncDir: "/sync/broken",
    encryptionKey: null,
  } as WorkspaceMeta,
}));
const { workspace, workspaceMeta } = mocks;

vi.mock("@yaakapp-internal/models", async () => {
  const { atom } = await import("jotai");
  return {
    workspacesAtom: atom([mocks.workspace]),
    // Starts empty in each test: the workspace failed to load, so the store has no meta for it
    workspaceMetasAtom: atom<WorkspaceMeta[]>([]),
    mergeModelsInStore: mocks.mergeModelsInStore,
    patchModel: vi.fn(),
  };
});
vi.mock("@yaakapp-internal/ui", () => ({
  Banner: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  CountBadge: () => null,
  HStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InlineCode: ({ children }: { children: ReactNode }) => <code>{children}</code>,
}));
vi.mock("../hooks/useAuthTab", () => ({ useAuthTab: () => [] }));
vi.mock("../hooks/useHeadersTab", () => ({ useHeadersTab: () => [] }));
vi.mock("../hooks/useInheritedHeaders", () => ({ useInheritedHeaders: () => [] }));
vi.mock("../lib/deleteModelWithConfirm", () => ({
  deleteModelWithConfirm: mocks.deleteModelWithConfirm,
}));
vi.mock("../lib/dialog", () => ({ showDialog: vi.fn() }));
vi.mock("../lib/router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("../lib/rpc", () => ({ rpc: mocks.rpc }));
vi.mock("./CopyIconButton", () => ({ CopyIconButton: () => null }));
vi.mock("./core/Button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("./core/PlainInput", () => ({
  PlainInput: ({ label, defaultValue }: { label: string; defaultValue: string }) => (
    <input aria-label={label} defaultValue={defaultValue} />
  ),
}));
vi.mock("./core/SettingRow", () => ({
  SettingsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// Render every tab at once so the test can see all of them
vi.mock("./core/Tabs/Tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabContent: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-tab={value}>{children}</div>
  ),
}));
vi.mock("./DnsOverridesEditor", () => ({ DnsOverridesEditor: () => null }));
vi.mock("./HeadersEditor", () => ({ HeadersEditor: () => null }));
vi.mock("./HttpAuthenticationEditor", () => ({ HttpAuthenticationEditor: () => null }));
vi.mock("./MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("./ModelSettingsEditor", () => ({ ModelSettingsEditor: () => null }));
vi.mock("./SyncToFilesystemSetting", () => ({
  SyncToFilesystemSetting: ({ value }: { value: { filePath: string | null } }) => (
    <div data-testid="sync-setting">{value.filePath}</div>
  ),
}));
vi.mock("./WorkspaceEncryptionSetting", () => ({
  WorkspaceEncryptionSetting: () => <div data-testid="encryption-setting" />,
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  // Behave like the real store: merged models land in the atom the dialog reads
  const store = getDefaultStore();
  const metasAtom = workspaceMetasAtom as unknown as PrimitiveAtom<WorkspaceMeta[]>;
  store.set(metasAtom, []);
  mocks.mergeModelsInStore.mockImplementation((_model: string, models: WorkspaceMeta[]) =>
    store.set(metasAtom, (prev) => [...prev, ...models]),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(<WorkspaceSettingsDialog workspaceId="wk_test" hide={() => {}} />),
  );
}

function tab(value: string) {
  const el = host.querySelector(`[data-tab="${value}"]`);
  if (el == null) throw new Error(`No ${value} tab`);
  return el;
}

function deleteButton() {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "Delete Workspace",
  );
}

test("a workspace with no meta in the store still offers Delete", async () => {
  mocks.rpc.mockReturnValue(new Promise(() => {}));
  mocks.deleteModelWithConfirm.mockResolvedValue(false);
  await render();

  expect(host.textContent).not.toContain("not found");
  const button = deleteButton();
  expect(button).toBeDefined();

  await act(async () => button?.click());
  expect(mocks.deleteModelWithConfirm).toHaveBeenCalledWith(workspace, { confirmName: "Broken" });
});

test("a missing meta is fetched, put in the store, and its settings rendered", async () => {
  mocks.rpc.mockResolvedValue(workspaceMeta);
  await render();

  expect(mocks.rpc).toHaveBeenCalledWith("cmd_get_workspace_meta", { workspaceId: "wk_test" });
  expect(mocks.mergeModelsInStore).toHaveBeenCalledWith("workspace_meta", [workspaceMeta]);

  const settings = tab("settings");
  expect(settings.querySelector('[data-testid="sync-setting"]')?.textContent).toBe("/sync/broken");
  expect(settings.querySelector('[data-testid="encryption-setting"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("a meta that cannot be loaded shows the error only where sync and encryption go", async () => {
  mocks.rpc.mockRejectedValue("database is locked");
  await render();

  // The error is the one banner, inside the Settings tab, in place of sync and encryption
  const banners = host.querySelectorAll('[role="alert"]');
  expect(banners).toHaveLength(1);
  expect(tab("settings").contains(banners[0] ?? null)).toBe(true);
  expect(banners[0]?.textContent).toContain("database is locked");
  expect(host.querySelector('[data-testid="sync-setting"]')).toBeNull();
  expect(host.querySelector('[data-testid="encryption-setting"]')).toBeNull();
  expect(mocks.mergeModelsInStore).not.toHaveBeenCalled();

  // The workspace's own settings and Delete still render
  const general = tab("general");
  expect(general.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.value).toBe("Broken");
  expect(general.contains(deleteButton() ?? null)).toBe(true);
});
