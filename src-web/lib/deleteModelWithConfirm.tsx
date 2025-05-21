import type { AnyModel } from '@yaakapp-internal/models';
import { deleteModel, modelTypeLabel } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from './confirm';
import { resolvedModelName } from './resolvedModelName';

export async function deleteModelWithConfirm(model: AnyModel | null): Promise<boolean> {
  if (model == null ) {
    console.warn('Tried to delete null model');
    return false;
  }

  const confirmed = await showConfirmDelete({
    id: 'delete-model-' + model.id,
    title: 'Delete ' + modelTypeLabel(model),
    description: (
      <>
        Permanently delete <InlineCode>{resolvedModelName(model)}</InlineCode>?
      </>
    ),
  });

  if (!confirmed) {
    return false;
  }

  await deleteModel(model);
  return true;
}
