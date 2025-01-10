import classNames from 'classnames';
import type { ReactNode } from 'react';
import { memo, useEffect, useRef } from 'react';
import { trackEvent } from '../../../lib/analytics';
import { Icon } from '../Icon';
import type { RadioDropdownProps } from '../RadioDropdown';
import { RadioDropdown } from '../RadioDropdown';
import { HStack } from '../Stacks';

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
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  value = value ?? tabs[0]?.value;

  // Update tabs when value changes
  useEffect(() => {
    const tabs = ref.current?.querySelectorAll<HTMLDivElement>(`[data-tab]`);
    for (const tab of tabs ?? []) {
      const v = tab.getAttribute('data-tab');
      if (v === value) {
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
        'h-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1 ',
      )}
    >
      <div
        aria-label={label}
        className={classNames(
          tabListClassName,
          addBorders && '!-ml-1 h-md mt-2',
          'flex items-center overflow-x-auto overflow-y-visible hide-scrollbars mt-1 mb-2',
          // Give space for button focus states within overflow boundary.
          '-ml-5 pl-3 pr-1 py-1',
        )}
      >
        <HStack space={2} className="h-full flex-shrink-0">
          {tabs.map((t) => {
            const isActive = t.value === value;
            const btnClassName = classNames(
              'h-full flex items-center rounded',
              '!px-2 ml-[1px]',
              addBorders && 'border',
              isActive ? 'text-text' : 'text-text-subtle hover:text-text',
              isActive && addBorders ? 'border-border-subtle' : 'border-transparent',
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
                    onClick={
                      isActive
                        ? undefined
                        : () => {
                            trackEvent('tab', 'click', { label, tab: t.value });
                            onChangeValue(t.value);
                          }
                    }
                    className={btnClassName}
                  >
                    {option && 'shortLabel' in option
                      ? option.shortLabel
                      : (option?.label ?? 'Unknown')}
                    {t.rightSlot}
                    <Icon
                      size="sm"
                      icon="chevron_down"
                      className={classNames('ml-1', isActive ? 'text-text-subtle' : 'opacity-50')}
                    />
                  </button>
                </RadioDropdown>
              );
            } else {
              return (
                <button
                  key={t.value}
                  onClick={
                    isActive
                      ? undefined
                      : () => {
                          trackEvent('tab', 'click', { label, tab: t.value });
                          onChangeValue(t.value);
                        }
                  }
                  className={btnClassName}
                >
                  {t.label}
                  {t.rightSlot}
                </button>
              );
            }
          })}
        </HStack>
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
    <div
      tabIndex={-1}
      data-tab={value}
      className={classNames(className, 'tab-content', 'hidden w-full h-full')}
    >
      {children}
    </div>
  );
});
