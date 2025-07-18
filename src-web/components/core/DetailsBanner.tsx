import classNames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';
import type { BannerProps } from './Banner';
import { Banner } from './Banner';

interface Props extends HTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  color?: BannerProps['color'];
  open?: boolean;
}

export function DetailsBanner({ className, color, summary, children, ...extraProps }: Props) {
  return (
    <Banner color={color} className={className}>
      <details className="group list-none" {...extraProps}>
        <summary className="!cursor-default !select-none list-none flex items-center gap-2 focus:outline-none opacity-70 hover:opacity-100 focus:opacity-100">
          <div
            className={classNames(
              'transition-transform',
              'group-open:rotate-90',
              'w-0 h-0 border-t-[0.3em] border-b-[0.3em] border-l-[0.5em] border-r-0',
              'border-t-transparent border-b-transparent border-l-text-subtle',
            )}
          ></div>
          {summary}
        </summary>
        {children}
      </details>
    </Banner>
  );
}
