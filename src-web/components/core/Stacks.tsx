import classNames from 'classnames';
import type { ComponentType, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

const gapClasses = {
  0: 'gap-0',
  0.5: 'gap-0.5',
  1: 'gap-1',
  1.5: 'gap-1.5',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
};

interface HStackProps extends BaseStackProps {
  children?: ReactNode;
}

export const HStack = forwardRef(function HStack(
  { className, space, children, alignItems = 'center', ...props }: HStackProps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: ForwardedRef<any>,
) {
  return (
    <BaseStack
      ref={ref}
      className={classNames(className, 'flex-row', space != null && gapClasses[space])}
      alignItems={alignItems}
      {...props}
    >
      {children}
    </BaseStack>
  );
});

export type VStackProps = BaseStackProps & {
  children: ReactNode;
};

export const VStack = forwardRef(function VStack(
  { className, space, children, ...props }: VStackProps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: ForwardedRef<any>,
) {
  return (
    <BaseStack
      ref={ref}
      className={classNames(className, 'flex-col', space != null && gapClasses[space])}
      {...props}
    >
      {children}
    </BaseStack>
  );
});

type BaseStackProps = HTMLAttributes<HTMLElement> & {
  as?: ComponentType | 'ul' | 'label' | 'form' | 'p';
  space?: keyof typeof gapClasses;
  alignItems?: 'start' | 'center' | 'stretch' | 'end';
  justifyContent?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
};

const BaseStack = forwardRef(function BaseStack(
  { className, alignItems, justifyContent, wrap, children, as, ...props }: BaseStackProps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: ForwardedRef<any>,
) {
  const Component = as ?? 'div';
  return (
    <Component
      ref={ref}
      className={classNames(
        className,
        'flex',
        wrap && 'flex-wrap',
        alignItems === 'center' && 'items-center',
        alignItems === 'start' && 'items-start',
        alignItems === 'stretch' && 'items-stretch',
        alignItems === 'end' && 'items-end',
        justifyContent === 'start' && 'justify-start',
        justifyContent === 'center' && 'justify-center',
        justifyContent === 'end' && 'justify-end',
        justifyContent === 'between' && 'justify-between',
      )}
      {...props}
    >
      {children}
    </Component>
  );
});
