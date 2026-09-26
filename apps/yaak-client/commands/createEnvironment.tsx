import type { Environment } from "@yaakapp-internal/models";
import { CreateEnvironmentDialog } from "../components/CreateEnvironmentDialog";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { showDialog } from "../lib/dialog";
import { jotaiStore } from "../lib/jotai";
import { setWorkspaceSearchParams } from "../lib/setWorkspaceSearchParams";

/**
 * Prompt for and create a sub-environment of the given base environment, resolving with the new
 * environment's ID (or null if the dialog was dismissed). This does not change the workspace's
 * active environment.
 */
export const createSubEnvironment = createFastMutation<string | null, unknown, Environment | null>({
  mutationKey: ["create_environment"],
  mutationFn: async (baseEnvironment) => {
    if (baseEnvironment == null) {
      throw new Error("No base environment passed");
    }

    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) {
      throw new Error("Cannot create environment when no active workspace");
    }

    return new Promise<string | null>((resolve) => {
      showDialog({
        id: "new-environment",
        title: "New Environment",
        description: "Create multiple environments with different sets of variables",
        size: "sm",
        onClose: () => resolve(null),
        render: ({ hide }) => (
          <CreateEnvironmentDialog
            workspaceId={workspaceId}
            hide={hide}
            onCreate={(id: string) => {
              resolve(id);
            }}
          />
        ),
      });
    });
  },
});

/** Same as {@link createSubEnvironment}, but also makes the new environment the active one. */
export const createSubEnvironmentAndActivate = createFastMutation<
  string | null,
  unknown,
  Environment | null
>({
  mutationKey: ["create_environment_and_activate"],
  mutationFn: (baseEnvironment) => createSubEnvironment.mutateAsync(baseEnvironment),
  disableToastError: true, // Already shown by createSubEnvironment
  onSuccess: async (environmentId) => {
    if (environmentId == null) {
      return; // Was not created
    }

    setWorkspaceSearchParams({ environment_id: environmentId });
  },
});
