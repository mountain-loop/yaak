import type { Environment } from '@yaakapp-internal/models';
import { showColorPicker } from '../lib/showColorPicker';
import { ColorIndicator } from './ColorIndicator';

export function EnvironmentColorIndicator({
  environment,
  clickToEdit,
}: {
  environment: Environment | null;
  clickToEdit?: boolean;
}) {
  if (environment?.color == null) return null;

  return (
    <ColorIndicator
      color={environment?.color ?? null}
      onClick={clickToEdit ? () => showColorPicker(environment) : undefined}
    />
  );
}
