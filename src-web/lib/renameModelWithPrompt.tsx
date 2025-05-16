import type { AnyModel} from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showPrompt } from './prompt';

export async function renameModelWithPrompt(model: Extract<AnyModel, { name: string }> | null) {
  if (model == null) {
    throw new Error('Tried to rename null model');
  }

  const name = await showPrompt({
    id: 'rename-request',
    title: 'Rename Request',
    description:
      model.name === '' ? (
        'Enter a new name'
      ) : (
        <>
          Enter a new name for <InlineCode>{model.name}</InlineCode>
        </>
      ),
    label: 'Name',
    placeholder: 'New Name',
    defaultValue: model.name,
    confirmText: 'Save',
  });

  if (name == null) return;

  await patchModel(model, { name });
}
