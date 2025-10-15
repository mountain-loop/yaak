import type { AnyModel } from '@yaakapp-internal/models';
import { deleteModel, modelTypeLabel } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { Prose } from '../components/Prose';
import { showConfirmDelete } from './confirm';
import { pluralizeCount } from './pluralize';
import { resolvedModelName } from './resolvedModelName';

export async function deleteModelWithConfirm(
  model: AnyModel | AnyModel[] | null,
  options: { confirmName?: string } = {},
): Promise<boolean> {
  if (model == null) {
    console.warn('Tried to delete null model');
    return false;
  }
  const models = Array.isArray(model) ? model : [model];
  const descriptor =
    models.length === 1 ? modelTypeLabel(models[0]!) : pluralizeCount('Item', models.length);
  const confirmed = await showConfirmDelete({
    id: 'delete-model-' + models.map((m) => m.id).join(','),
    title: `Delete ${descriptor}`,
    requireTyping: options.confirmName,
    description: (
      <>
        Permanently delete{' '}
        {models.length === 1 ? (
          <>
            <InlineCode>{resolvedModelName(models[0]!)}</InlineCode>?
          </>
        ) : models.length < 10 ? (
          <>
            the following?
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
          `all ${pluralizeCount('item', models.length)}?`
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
