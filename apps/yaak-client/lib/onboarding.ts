import type { BatchUpsertResult } from "@yaakapp-internal/models";
import { createGlobalModel } from "@yaakapp-internal/models";
import { router } from "./router";
import { rpc } from "./rpc";
import { setKeyValue } from "./keyValueStore";

export type OnboardingChoice =
  | "import"
  | "import_yaak"
  | "example"
  | "fresh"
  | "open_folder"
  | "clone_git";

const NEW_WORKSPACE_NAME = "My Workspace";

/**
 * Remembered so later surfaces can lean toward what the user came for (an importer, the
 * example, or a blank slate). Nothing reads it yet.
 */
export function recordOnboardingChoice(choice: OnboardingChoice) {
  setKeyValue({
    namespace: "global",
    key: "onboarding",
    value: { choice, at: new Date().toISOString() },
  }).catch(console.error);
}

export async function createFreshWorkspace() {
  const workspaceId = await createGlobalModel({ model: "workspace", name: NEW_WORKSPACE_NAME });
  await router.navigate({ to: "/workspaces/$workspaceId", params: { workspaceId } });
}

export async function createExampleWorkspace() {
  const created = await rpc<BatchUpsertResult>("cmd_create_example_workspace", {});
  const workspace = created.workspaces[0];
  if (workspace == null) throw new Error("Example workspace was not created");
  const firstRequest = created.httpRequests.find((r) => r.name === "List posts");
  await router.navigate({
    to: "/workspaces/$workspaceId",
    params: { workspaceId: workspace.id },
    search: firstRequest ? { request_id: firstRequest.id } : {},
  });
}
