import classNames from 'classnames';
import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useRandomKey } from '../../hooks/useRandomKey';
import { Icon } from './Icon';
import { PlainInput } from './PlainInput';

interface Props {
  onChange: (value: string | null) => void;
  color: string | null;
  className?: string;
}

export function ColorPicker({ onChange, color, className }: Props) {
  const [updateKey, regenerateKey] = useRandomKey();
  return (
    <div className={className}>
      <HexColorPicker
        color={color ?? undefined}
        className="!w-full"
        onChange={(color) => {
          onChange(color);
          regenerateKey(); // To force input to change
        }}
      />
      <PlainInput
        hideLabel
        label="Plain Color"
        forceUpdateKey={updateKey}
        defaultValue={color ?? ''}
        onChange={onChange}
        validate={(color) => color.match(/#[0-9a-fA-F]{6}$/) !== null}
      />
    </div>
  );
}

const colors = [
  null,
  'danger',
  'warning',
  'notice',
  'success',
  'primary',
  'info',
  'secondary',
  'custom',
] as const;

export function ColorPickerWithThemeColors({ onChange, color, className }: Props) {
  const [updateKey, regenerateKey] = useRandomKey();
  const [selectedColor, setSelectedColor] = useState<string | null>(() => {
    if (color == null) return null;
    const c = color?.match(/var\(--([a-z]+)\)/)?.[1];
    return c ?? 'custom';
  });
  return (
    <div className={classNames(className, 'flex flex-col gap-3')}>
      <div className="flex items-center gap-2.5">
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            onClick={() => {
              setSelectedColor(color);
              if (color == null) {
                onChange(null);
              } else if (color === 'custom') {
                onChange('#ffffff');
              } else {
                onChange(`var(--${color})`);
              }
            }}
            className={classNames(
              'flex items-center justify-center',
              'w-8 h-8 rounded-full transition-all',
              selectedColor === color && 'scale-[1.15]',
              selectedColor === color ? 'opacity-100' : 'opacity-60',
              color === null && 'border border-text-subtle',
              color === 'primary' && 'bg-primary',
              color === 'secondary' && 'bg-secondary',
              color === 'success' && 'bg-success',
              color === 'notice' && 'bg-notice',
              color === 'warning' && 'bg-warning',
              color === 'danger' && 'bg-danger',
              color === 'info' && 'bg-info',
              color === 'custom' &&
                'bg-[conic-gradient(var(--danger),var(--warning),var(--notice),var(--success),var(--info),var(--primary),var(--danger))]',
            )}
          >
            {color == null && <Icon icon="minus" className="text-text-subtle" size="md" />}
          </button>
        ))}
      </div>
      {selectedColor === 'custom' && (
        <>
          <HexColorPicker
            color={color ?? undefined}
            className="!w-full"
            onChange={(color) => {
              onChange(color);
              regenerateKey(); // To force input to change
            }}
          />
          <PlainInput
            hideLabel
            label="Plain Color"
            forceUpdateKey={updateKey}
            defaultValue={color ?? ''}
            onChange={onChange}
            validate={(color) => color.match(/#[0-9a-fA-F]{6}$/) !== null}
          />
        </>
      )}
    </div>
  );
}
