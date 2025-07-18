import { Link as RouterLink } from '@tanstack/react-router';
import classNames from 'classnames';
import type { HTMLAttributes } from 'react';
import { appInfo } from '../../lib/appInfo';
import { Icon } from './Icon';

interface Props extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
  noUnderline?: boolean;
}

export function Link({ href, children, noUnderline, className, ...other }: Props) {
  const isExternal = href.match(/^https?:\/\//);

  className = classNames(className, 'relative');

  if (isExternal) {
    let finalHref = href;
    if (href.startsWith('https://yaak.app')) {
      const url = new URL(href);
      url.searchParams.set('ref', appInfo.identifier);
      finalHref = url.toString();
    }
    return (
      <a
        href={finalHref}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames(
          className,
          'pr-4 inline-flex items-center hover:underline group',
          !noUnderline && 'underline',
        )}
        onClick={(e) => {
          e.preventDefault();
        }}
        {...other}
      >
        <span className="pr-0.5">{children}</span>
        <Icon className="inline absolute right-0.5 top-[0.3em] opacity-70 group-hover:opacity-100" size="xs" icon="external_link" />
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
