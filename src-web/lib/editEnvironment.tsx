import type { Environment } from '@yaakapp-internal/models';
import { openFolderSettings } from '../commands/openFolderSettings';
import { EnvironmentEditDialog } from '../components/EnvironmentEditDialog';
import { toggleDialog } from './dialog';

export function editEnvironment(environment: Environment | null) {
  if (environment?.parentModel === 'folder' && environment.parentId != null) {
    openFolderSettings(environment.parentId, 'variables');
  } else {
    toggleDialog({
      id: 'environment-editor',
      noPadding: true,
      size: 'lg',
      className: 'h-[80vh]',
      render: () => <EnvironmentEditDialog initialEnvironment={environment} />,
    });
  }
}
