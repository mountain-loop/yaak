import type { Folder } from "@yaakapp-internal/models";
import { modelTypeLabel, patchModel } from "@yaakapp-internal/models";
import { useMemo } from "react";
import { openFolderSettings } from "../commands/openFolderSettings";
import { openWorkspaceSettings } from "../commands/openWorkspaceSettings";
import { Icon } from "../components/core/Icon";
import { IconTooltip } from "../components/core/IconTooltip";
import { InlineCode } from "../components/core/InlineCode";
import { HStack } from "../components/core/Stacks";
import type { TabItem } from "../components/core/Tabs/Tabs";
import { showConfirm } from "../lib/confirm";
import { resolvedModelName } from "../lib/resolvedModelName";
import { useHttpAuthenticationSummaries } from "./useHttpAuthentication";
import type { AuthenticatedModel } from "./useInheritedAuthentication";
import { useInheritedAuthentication } from "./useInheritedAuthentication";
import { useModelAncestors } from "./useModelAncestors";

export function useAuthTab<T extends string>(tabValue: T, model: AuthenticatedModel | null) {
  const authentication = useHttpAuthenticationSummaries();
  const inheritedAuth = useInheritedAuthentication(model);
  const ancestors = useModelAncestors(model);
  const parentModel = ancestors[0] ?? null;

  return useMemo<TabItem[]>(() => {
    if (model == null) return [];

    const tab: TabItem = {
      value: tabValue,
      label: "Аутентификация",
      options: {
        value: model.authenticationType,
        items: [
          ...authentication.map((a) => ({
            label: a.label || "НЕИЗВЕСТНО",
            shortLabel: a.shortLabel,
            value: a.name,
          })),
          { type: "separator" },
          {
            label: "Наследовать от родителя",
            shortLabel:
              inheritedAuth != null && inheritedAuth.authenticationType !== "none" ? (
                <HStack space={1.5}>
                  {authentication.find((a) => a.name === inheritedAuth.authenticationType)
                    ?.shortLabel ?? "НЕИЗВЕСТНО"}
                  <IconTooltip
                    icon="magic_wand"
                    iconSize="xs"
                    content="Аутентификация унаследована от предка"
                  />
                </HStack>
              ) : (
                "Аутентификация"
              ),
            value: null,
          },
          { label: "Без аутентификации", shortLabel: "Без аутентификации", value: "none" },
        ],
        itemsAfter: (() => {
          const actions: (
            | { type: "separator"; label: string }
            | { label: string; leftSlot: React.ReactNode; onSelect: () => Promise<void> }
          )[] = [];

          // Promote: move auth from current model up to parent
          if (
            parentModel &&
            model.authenticationType &&
            model.authenticationType !== "none" &&
            (parentModel.authenticationType == null || parentModel.authenticationType === "none")
          ) {
            actions.push(
              { type: "separator", label: "Действия" },
              {
                label: `Поднять в ${modelTypeLabel(parentModel)}`,
                leftSlot: (
                  <Icon
                    icon={parentModel.model === "workspace" ? "corner_right_up" : "folder_up"}
                  />
                ),
                onSelect: async () => {
                  const confirmed = await showConfirm({
                    id: "promote-auth-confirm",
                    title: "Поднять аутентификацию",
                    confirmText: "Поднять",
                    description: (
                      <>
                        Переместить конфигурацию аутентификации в{" "}
                        <InlineCode>{resolvedModelName(parentModel)}</InlineCode>?
                      </>
                    ),
                  });
                  if (confirmed) {
                    await patchModel(model, { authentication: {}, authenticationType: null });
                    await patchModel(parentModel, {
                      authentication: model.authentication,
                      authenticationType: model.authenticationType,
                    });

                    if (parentModel.model === "folder") {
                      openFolderSettings(parentModel.id, "auth");
                    } else {
                      openWorkspaceSettings("auth");
                    }
                  }
                },
              },
            );
          }

          // Copy from ancestor: copy auth config down to current model
          const ancestorWithAuth = ancestors.find(
            (a) => a.authenticationType != null && a.authenticationType !== "none",
          );
          if (ancestorWithAuth) {
            if (actions.length === 0) {
              actions.push({ type: "separator", label: "Действия" });
            }
            actions.push({
              label: `Скопировать из ${modelTypeLabel(ancestorWithAuth)}`,
              leftSlot: (
                <Icon
                  icon={
                    ancestorWithAuth.model === "workspace" ? "corner_right_down" : "folder_down"
                  }
                />
              ),
              onSelect: async () => {
                const confirmed = await showConfirm({
                  id: "copy-auth-confirm",
                  title: "Скопировать аутентификацию",
                  confirmText: "Копировать",
                  description: (
                    <>
                      Скопировать{" "}
                      {authentication.find((a) => a.name === ancestorWithAuth.authenticationType)
                        ?.label ?? "аутентификацию"}{" "}
                      из <InlineCode>{resolvedModelName(ancestorWithAuth)}</InlineCode>?
                      Это действие заменит текущую аутентификацию, но не повлияет на{" "}
                      {modelTypeLabel(ancestorWithAuth).toLowerCase()}.
                    </>
                  ),
                });
                if (confirmed) {
                  await patchModel(model, {
                    authentication: { ...ancestorWithAuth.authentication },
                    authenticationType: ancestorWithAuth.authenticationType,
                  });
                }
              },
            });
          }

          return actions.length > 0 ? actions : undefined;
        })(),
        onChange: async (authenticationType) => {
          let authentication: Folder["authentication"] = model.authentication;
          if (model.authenticationType !== authenticationType) {
            authentication = {
              // Reset auth if changing types
            };
          }
          await patchModel(model, { authentication, authenticationType });
        },
      },
    };

    return [tab];
  }, [authentication, inheritedAuth, model, parentModel, tabValue, ancestors]);
}
