import type { Environment, EnvironmentVariable } from '@yaakapp-internal/models';
import { openFolderSettings } from '../commands/openFolderSettings';
import { EnvironmentEditDialog } from '../components/EnvironmentEditDialog';
import { toggleDialog } from './dialog';

interface Options {
  addOrFocusVariable?: EnvironmentVariable;
}

export function editEnvironment(environment: Environment | null, options: Options = {}) {
  if (environment?.parentModel === 'folder' && environment.parentId != null) {
    openFolderSettings(environment.parentId, 'variables');
  } else {
    toggleDialog({
      id: 'environment-editor',
      noPadding: true,
      size: 'lg',
      className: 'h-[80vh]',
      render: () => (
        <EnvironmentEditDialog
          initialEnvironmentId={environment?.id ?? null}
          addOrFocusVariable={options.addOrFocusVariable}
        />
      ),
    });
  }
}
