import type { AnyModel } from "@yaakapp-internal/models";
import { deleteModel, modelTypeLabel } from "@yaakapp-internal/models";
import { InlineCode } from "../components/core/InlineCode";
import { Prose } from "../components/Prose";
import { showConfirmDelete } from "./confirm";
import { resolvedModelName } from "./resolvedModelName";

function countItems(count: number): string {
  return `${count} ${count === 1 ? "элемент" : "элементов"}`;
}

export async function deleteModelWithConfirm(
  model: AnyModel | AnyModel[] | null,
  options: { confirmName?: string } = {},
): Promise<boolean> {
  if (model == null) {
    console.warn("Tried to delete null model");
    return false;
  }
  const models = Array.isArray(model) ? model : [model];
  const firstModel = models[0];
  if (firstModel == null) return false;

  const descriptor = models.length === 1 ? modelTypeLabel(firstModel) : countItems(models.length);
  const confirmed = await showConfirmDelete({
    id: `delete-model-${models.map((m) => m.id).join(",")}`,
    title: `Удалить ${descriptor}`,
    requireTyping: options.confirmName,
    description: (
      <>
        Удалить безвозвратно{" "}
        {models.length === 1 ? (
          <>
            <InlineCode>{resolvedModelName(firstModel)}</InlineCode>?
          </>
        ) : models.length < 10 ? (
          <>
            следующее?
            <Prose className="mt-2">
              <ul>
                {models.map((m) => (
                  <li key={m.id}>
                    <InlineCode>{resolvedModelName(m)}</InlineCode>
                  </li>
                ))}
              </ul>
            </Prose>
          </>
        ) : (
          `все ${countItems(models.length)}?`
        )}
      </>
    ),
  });

  if (!confirmed) {
    return false;
  }

  await Promise.allSettled(models.map((m) => deleteModel(m)));
  return true;
}
