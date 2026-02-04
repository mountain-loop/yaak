import classNames from 'classnames';
import type { ReactNode } from 'react';

export interface RadioCardOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
}

export interface RadioCardsProps<T extends string> {
  value: T | null;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  name: string;
}

export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  name,
}: RadioCardsProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            className={classNames(
              'flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
              'transition-colors',
              selected
                ? 'border-border-focus'
                : 'border-border-subtle hocus:border-text-subtlest',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <div
              className={classNames(
                'mt-1 w-4 h-4 flex-shrink-0 rounded-full border',
                'flex items-center justify-center',
                selected ? 'border-focus' : 'border-border',
              )}
            >
              {selected && <div className="w-2 h-2 rounded-full bg-text" />}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-text">{option.label}</span>
              {option.description && (
                <span className="text-sm text-text-subtle">{option.description}</span>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
