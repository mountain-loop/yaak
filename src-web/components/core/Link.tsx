import classNames from 'classnames';
import type { HTMLAttributes } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { trackEvent } from '../../lib/analytics';
import { Icon } from './Icon';

interface Props extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
  event?: string;
}

export function Link({ href, children, className, event, ...other }: Props) {
  const isExternal = href.match(/^https?:\/\//);

  className = classNames(className, 'relative underline hover:text-violet-600');

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames(className, 'pr-4 inline-flex items-center')}
        onClick={(e) => {
          e.preventDefault();
          if (event != null) {
            trackEvent('link', 'click', { id: event });
          }
        }}
        {...other}
      >
        <span className="underline">{children}</span>
        <Icon className="inline absolute right-0.5 top-[0.3em]" size="xs" icon="external_link" />
      </a>
    );
  }

  return (
    <RouterLink to={href} className={className} {...other}>
      {children}
    </RouterLink>
  );
}

export function FeedbackLink() {
  return <Link href="https://yaak.app/roadmap">Feedback</Link>;
}
