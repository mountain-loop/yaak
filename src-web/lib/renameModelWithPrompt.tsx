import type { AnyModel } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { InlineCode } from "../components/core/InlineCode";
import { showPrompt } from "./prompt";

export async function renameModelWithPrompt(model: Extract<AnyModel, { name: string }> | null) {
  if (model == null) {
    throw new Error("Tried to rename null model");
  }

  const name = await showPrompt({
    id: "rename-request",
    title: "Переименовать запрос",
    required: false,
    description:
      model.name === "" ? (
        "Введите новое имя"
      ) : (
        <>
          Введите новое имя для <InlineCode>{model.name}</InlineCode>
        </>
      ),
    label: "Название",
    placeholder: "Новое название",
    defaultValue: model.name,
    confirmText: "Сохранить",
  });

  if (name == null) return;

  await patchModel(model, { name });
}
