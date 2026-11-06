import classNames from "classnames";
import type { HTMLAttributes } from "react";
import { useEditorHost } from "./EditorHost";
import { Icon } from "./Icon";

export interface ExternalLinkProps extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
  noUnderline?: boolean;
  /** Opens the link; defaults to the host's `openUrl`, then a new browser tab */
  onOpen?: (href: string) => void;
}

/** A link that leaves the app, marked with an external-link icon */
export function ExternalLink({
  href,
  children,
  noUnderline,
  className,
  onOpen,
  ...other
}: ExternalLinkProps) {
  const host = useEditorHost();
  const open = onOpen ?? host.openUrl;
  const isYaakLink = href.startsWith("https://yaak.app");

  return (
    // eslint-disable-next-line react/jsx-no-target-blank
    <a
      href={href}
      target="_blank"
      rel={isYaakLink ? undefined : "noopener noreferrer"}
      onClick={(e) => {
        if (open == null) return;
        e.preventDefault();
        open(href);
      }}
      className={classNames(
        className,
        "relative",
        "inline-flex items-center hover:underline group",
        !noUnderline && "underline",
      )}
      {...other}
    >
      <span className="pr-5">{children}</span>
      <Icon
        className="inline absolute right-0.5 top-[0.3em] opacity-70 group-hover:opacity-100"
        size="xs"
        icon="external_link"
      />
    </a>
  );
}
