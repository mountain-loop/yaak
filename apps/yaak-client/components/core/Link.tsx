import { Link as RouterLink } from "@tanstack/react-router";
import { platform } from "@yaakapp-internal/platform";
import classNames from "classnames";
import type { HTMLAttributes } from "react";
import { appInfo } from "../../lib/appInfo";
import { ExternalLink } from "@yaakapp-internal/ui";

interface Props extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
  noUnderline?: boolean;
}

/** Tags a link to yaak.app with which app it came from */
export function withYaakRef(href: string): string {
  if (!href.startsWith("https://yaak.app")) return href;
  const url = new URL(href);
  url.searchParams.set("ref", appInfo.identifier);
  return url.toString();
}

/** Opens a link outside the app, tagged as `Link` tags it */
export function openExternalUrl(href: string) {
  void platform.openUrl(withYaakRef(href));
}

export function Link({ href, children, noUnderline, className, ...other }: Props) {
  const isExternal = href.match(/^https?:\/\//);

  if (isExternal) {
    return (
      <ExternalLink
        href={withYaakRef(href)}
        noUnderline={noUnderline}
        onOpen={openExternalUrl}
        className={className}
        {...other}
      >
        {children}
      </ExternalLink>
    );
  }

  className = classNames(
    className,
    "relative",
    "inline-flex items-center hover:underline group",
    !noUnderline && "underline",
  );

  return (
    <RouterLink to={href} className={className} {...other}>
      {children}
    </RouterLink>
  );
}

export function FeedbackLink() {
  return <Link href="https://yaak.app/roadmap">Feedback</Link>;
}
