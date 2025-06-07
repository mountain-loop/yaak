import type { Environment } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { showDialog } from './dialog';
import { EnvironmentColorPicker } from '../components/EnvironmentColorPicker';

export function showColorPicker(environment: Environment) {
  showDialog({
    title: 'Environment Color',
    id: 'color-picker',
    size: 'dynamic',
    render: ({ hide }) => {
      return (
        <EnvironmentColorPicker
          color={environment.color ?? '#54dc44'}
          onChange={async (color) => {
            await patchModel(environment, { color });
            hide();
          }}
        />
      );
    },
  });
}
