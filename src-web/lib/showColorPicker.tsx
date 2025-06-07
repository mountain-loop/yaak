import type { Environment } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { useState } from 'react';
import { Button } from '../components/core/Button';
import { ColorPicker } from '../components/core/ColorPicker';
import { showDialog } from './dialog';

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
