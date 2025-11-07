import type { Environment, EnvironmentVariable } from '@yaakapp-internal/models';
import { updateModel } from '@yaakapp-internal/models';
import { openFolderSettings } from '../commands/openFolderSettings';
import type { PairEditorHandle } from '../components/core/PairEditor';
import { ensurePairId } from '../components/core/PairEditor.util';
import { EnvironmentEditDialog } from '../components/EnvironmentEditDialog';
import { environmentsBreakdownAtom } from '../hooks/useEnvironmentsBreakdown';
import { toggleDialog } from './dialog';
import { jotaiStore } from './jotai';

interface Options {
  addOrFocusVariable?: EnvironmentVariable;
}

export async function editEnvironment(
  initialEnvironment: Environment | null,
  options: Options = {},
) {
  if (initialEnvironment?.parentModel === 'folder' && initialEnvironment.parentId != null) {
    openFolderSettings(initialEnvironment.parentId, 'variables');
  } else {
    const { addOrFocusVariable } = options;
    const { baseEnvironment } = jotaiStore.get(environmentsBreakdownAtom);
    let environment = initialEnvironment ?? baseEnvironment;
    let focusId: string | null = null;

    if (addOrFocusVariable && environment != null) {
      const existing = environment.variables.find(
        (v) => v.id === addOrFocusVariable.id || v.name === addOrFocusVariable.name,
      );
      if (existing) {
        focusId = existing.id ?? null;
      } else {
        const newVar = ensurePairId(addOrFocusVariable);
        environment = { ...environment, variables: [...environment.variables, newVar] };
        await updateModel(environment);
        environment.variables.push(newVar);
        focusId = newVar.id;
      }
    }

    let didFocusVariable = false;

    toggleDialog({
      id: 'environment-editor',
      noPadding: true,
      size: 'lg',
      className: 'h-[80vh]',
      render: () => (
        <EnvironmentEditDialog
          initialEnvironmentId={environment?.id ?? null}
          setRef={(pairEditor: PairEditorHandle | null) => {
            if (focusId && !didFocusVariable) {
              pairEditor?.focusValue(focusId);
              didFocusVariable = true;
            }
          }}
        />
      ),
    });
  }
}
