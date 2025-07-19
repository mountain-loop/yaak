import classNames from 'classnames';
import type { ReactNode } from 'react';
import { memo, useEffect, useRef } from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import { Icon } from '../Icon';
import type { RadioDropdownProps } from '../RadioDropdown';
import { RadioDropdown } from '../RadioDropdown';

export type TabItem =
  | {
      value: string;
      label: string;
      rightSlot?: ReactNode;
    }
  | {
      value: string;
      options: Omit<RadioDropdownProps, 'children'>;
      rightSlot?: ReactNode;
    };

interface Props {
  label: string;
  value?: string;
  onChangeValue: (value: string) => void;
  tabs: TabItem[];
  tabListClassName?: string;
  className?: string;
  children: ReactNode;
  addBorders?: boolean;
  layout?: 'horizontal' | 'vertical';
}

export function Tabs({
  value,
  onChangeValue,
  label,
  children,
  tabs,
  className,
  tabListClassName,
  addBorders,
  layout = 'vertical',
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  value = value ?? tabs[0]?.value;

  // Update tabs when value changes
  useEffect(() => {
    const tabs = ref.current?.querySelectorAll<HTMLDivElement>(`[data-tab]`);
    for (const tab of tabs ?? []) {
      const v = tab.getAttribute('data-tab');
      const parent = tab.closest('.tabs-container');
      if (parent !== ref.current) {
        // Tab is part of a nested tab container, so ignore it
      } else if (v === value) {
        tab.setAttribute('tabindex', '-1');
        tab.setAttribute('data-state', 'active');
        tab.setAttribute('aria-hidden', 'false');
        tab.style.display = 'block';
      } else {
        tab.setAttribute('data-state', 'inactive');
        tab.setAttribute('aria-hidden', 'true');
        tab.style.display = 'none';
      }
    }
  }, [value]);

  return (
    <div
      ref={ref}
      className={classNames(
        className,
        'tabs-container',
        'transform-gpu',
        'h-full grid',
        layout === 'horizontal' && 'grid-rows-1 grid-cols-[auto_minmax(0,1fr)]',
        layout === 'vertical' && 'grid-rows-[auto_minmax(0,1fr)] grid-cols-1',
      )}
    >
      <div
        aria-label={label}
        className={classNames(
          tabListClassName,
          addBorders && '!-ml-1',
          'flex items-center hide-scrollbars mb-2',
          layout === 'horizontal' && 'h-full overflow-auto p-2',
          layout === 'vertical' && 'overflow-x-auto overflow-y-visible ',
          // Give space for button focus states within overflow boundary.
          layout === 'vertical' && 'py-1 -ml-5 pl-3 pr-1',
        )}
      >
        <div
          className={classNames(
            layout === 'horizontal' && 'flex flex-col gap-1 w-full pb-3 mb-auto',
            layout === 'vertical' && 'flex flex-row flex-shrink-0 gap-2 w-full',
          )}
        >
          {tabs.map((t) => {
            const isActive = t.value === value;
            const btnClassName = classNames(
              'h-sm flex items-center rounded whitespace-nowrap',
              '!px-2 ml-[1px] hocus:text-text',
              addBorders && 'border hocus:bg-surface-highlight',
              isActive ? 'text-text' : 'text-text-subtle',
              isActive && addBorders
                ? 'border-surface-active bg-surface-active'
                : layout === 'vertical'
                  ? 'border-border-subtle'
                  : 'border-transparent',
              layout === 'horizontal' && 'flex justify-between',
            );

            if ('options' in t) {
              const option = t.options.items.find(
                (i) => 'value' in i && i.value === t.options?.value,
              );
              return (
                <RadioDropdown
                  key={t.value}
                  items={t.options.items}
                  value={t.options.value}
                  onChange={t.options.onChange}
                >
                  <button
                    onClick={isActive ? undefined : () => onChangeValue(t.value)}
                    className={classNames(btnClassName)}
                  >
                    {option && 'shortLabel' in option && option.shortLabel
                      ? option.shortLabel
                      : (option?.label ?? 'Unknown')}
                    {t.rightSlot}
                    <Icon
                      size="sm"
                      icon="chevron_down"
                      className={classNames(
                        'ml-1',
                        isActive ? 'text-text-subtle' : 'text-text-subtlest',
                      )}
                    />
                  </button>
                </RadioDropdown>
              );
            } else {
              return (
                <button
                  key={t.value}
                  onClick={isActive ? undefined : () => onChangeValue(t.value)}
                  className={btnClassName}
                >
                  {t.label}
                  {t.rightSlot}
                </button>
              );
            }
          })}
        </div>
      </div>
      {children}
    </div>
  );
}

interface TabContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export const TabContent = memo(function TabContent({
  value,
  children,
  className,
}: TabContentProps) {
  return (
    <ErrorBoundary name={`Tab ${value}`}>
      <div
        tabIndex={-1}
        data-tab={value}
        className={classNames(className, 'tab-content', 'hidden w-full h-full py-2')}
      >
        {children}
      </div>
    </ErrorBoundary>
  );
});
