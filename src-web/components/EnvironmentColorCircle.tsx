import type { Environment } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { showColorPicker } from '../lib/showColorPicker';

export function EnvironmentColorCircle({
  environment,
  clickToEdit,
}: {
  environment: Environment | null;
  clickToEdit?: boolean;
}) {
  if (environment?.color == null) return null;

  const style = { backgroundColor: environment.color };
  const className =
    'inline-block w-[0.75em] h-[0.75em] rounded-full mr-1.5 border border-transparent';

  if (clickToEdit) {
    return (
      <button
        onClick={() => showColorPicker(environment)}
        style={style}
        className={classNames(className, 'hover:border-text')}
      />
    );
  } else {
    return <span style={style} className={className} />;
  }
}
