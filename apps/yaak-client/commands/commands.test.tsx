import type { FunctionComponent, ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { SyncOp } from "@yaakapp-internal/sync/bindings/gen_sync";
import type { DialogInstance } from "../components/Dialogs";
import { syncWorkspace } from "./commands";

const mocks = vi.hoisted(() => ({
  calculateSync: vi.fn(),
  applySync: vi.fn(),
  showDialog: vi.fn<(dialog: DialogInstance) => void>(),
  hideDialog: vi.fn(),
}));

vi.mock("@yaakapp-internal/sync", () => mocks);
vi.mock("@yaakapp-internal/models", () => ({
  createWorkspaceModel: vi.fn(),
  modelTypeLabel: () => "Request",
}));
vi.mock("@yaakapp-internal/ui", () => ({
  Banner: "div",
  InlineCode: "code",
  Table: "table",
  TableBody: "tbody",
  TableCell: "td",
  TableHead: "thead",
  TableHeaderCell: "th",
  TableRow: "tr",
  TruncatedWideTableCell: "td",
}));
vi.mock("../components/core/Button", () => ({ Button: "button" }));
vi.mock("../hooks/useActiveWorkspace", () => ({ activeWorkspaceIdAtom: null }));
vi.mock("../lib/dialog", () => mocks);
vi.mock("../lib/jotai", () => ({ jotaiStore: { get: vi.fn() } }));
vi.mock("../lib/prompt", () => ({ showPrompt: vi.fn() }));
vi.mock("../lib/resolvedModelName", () => ({ resolvedModelNameWithFolders: () => "Request" }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

const params = { workspaceId: "wk_test", syncDir: "/sync" };
const deletion = {
  type: "dbDelete",
  model: { id: "rq_test", model: "http_request" },
  state: {},
} as Extract<SyncOp, { type: "dbDelete" }>;
const update = {
  type: "dbUpdate",
  model: { id: "rq_test", model: "http_request" },
  fs: { model: { id: "rq_test", model: "http_request", name: "Updated" } },
  state: {},
} as Extract<SyncOp, { type: "dbUpdate" }>;

async function submit(dialog: DialogInstance) {
  const render = dialog.render as FunctionComponent<{ hide: () => void }>;
  const form = render({ hide: () => mocks.hideDialog(dialog.id) }) as ReactElement<{
    onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
  }>;
  await form.props.onSubmit({ preventDefault: vi.fn() });
}

function latestDialog() {
  const dialog = mocks.showDialog.mock.calls.at(-1)?.[0];
  if (dialog == null) throw new Error("Expected a sync dialog");
  return dialog;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.applySync.mockResolvedValue(true);
});

test("closes an obsolete dialog when the restored file leaves no changes", async () => {
  mocks.calculateSync.mockResolvedValueOnce([deletion]).mockResolvedValueOnce([]);
  await syncWorkspace.mutateAsync(params);
  mocks.applySync.mockResolvedValueOnce(false);

  await submit(latestDialog());

  expect(mocks.applySync).toHaveBeenCalledTimes(1);
  expect(mocks.applySync).toHaveBeenCalledWith(params.workspaceId, params.syncDir, [deletion]);
  expect(mocks.hideDialog).toHaveBeenCalledWith("commit-sync");
  expect(mocks.showDialog).toHaveBeenCalledTimes(1);
});

test("requires another confirmation for a changed plan", async () => {
  mocks.calculateSync.mockResolvedValueOnce([deletion]).mockResolvedValueOnce([update]);
  await syncWorkspace.mutateAsync(params);
  const original = latestDialog();
  mocks.applySync.mockResolvedValueOnce(false);

  await submit(original);

  expect(mocks.applySync).toHaveBeenCalledTimes(1);
  expect(mocks.showDialog).toHaveBeenCalledTimes(2);
  expect(mocks.hideDialog).not.toHaveBeenCalled();
  await submit(latestDialog());
  expect(mocks.applySync).toHaveBeenLastCalledWith(params.workspaceId, params.syncDir, [update]);
  expect(mocks.hideDialog).toHaveBeenCalledWith("commit-sync");
});

test("applies an unchanged reviewed plan and closes the dialog", async () => {
  mocks.calculateSync.mockResolvedValue([update]);
  await syncWorkspace.mutateAsync(params);
  await submit(latestDialog());

  expect(mocks.calculateSync).toHaveBeenCalledTimes(1);
  expect(mocks.applySync).toHaveBeenCalledTimes(1);
  expect(mocks.hideDialog).toHaveBeenCalledWith("commit-sync");
});

test("forced sync retries the current plan without requesting another confirmation", async () => {
  mocks.calculateSync.mockResolvedValueOnce([deletion]).mockResolvedValueOnce([update]);
  mocks.applySync.mockResolvedValueOnce(false);

  await syncWorkspace.mutateAsync({ ...params, force: true });

  expect(mocks.applySync).toHaveBeenCalledTimes(2);
  expect(mocks.applySync).toHaveBeenLastCalledWith(params.workspaceId, params.syncDir, [update]);
  expect(mocks.showDialog).not.toHaveBeenCalled();
});

test("outbound-only changes clear the old dialog and sync automatically", async () => {
  const outbound = { type: "fsUpdate", model: update.model, state: {} } as SyncOp;
  mocks.calculateSync.mockResolvedValueOnce([deletion]).mockResolvedValueOnce([outbound]);
  await syncWorkspace.mutateAsync(params);
  await syncWorkspace.mutateAsync(params);

  expect(mocks.applySync).toHaveBeenCalledWith(params.workspaceId, params.syncDir, [outbound]);
  expect(mocks.hideDialog).toHaveBeenCalledWith("commit-sync");
  expect(mocks.showDialog).toHaveBeenCalledTimes(1);
});
