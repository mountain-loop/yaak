import type { Environment } from '@yaakapp-internal/models';
import { showColorPicker } from '../lib/showColorPicker';
import { ColorIndicator } from './ColorIndicator';

export function EnvironmentColorIndicator({
  environment,
  clickToEdit,
  className,
}: {
  environment: Environment | null;
  clickToEdit?: boolean;
  className?: string;
}) {
  if (environment?.color == null) return null;

  return (
    <ColorIndicator
      className={className}
      color={environment?.color ?? null}
      onClick={clickToEdit ? () => showColorPicker(environment) : undefined}
    />
  );
}
