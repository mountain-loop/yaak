import type { ReactNode } from "react";
import { Heading } from "../Heading";

export interface SettingsPageProps {
  title: ReactNode;
  description?: ReactNode;
  /** Beside the heading, like the client's Add Certificate button */
  actions?: ReactNode;
  /** Between the header and the content, like the client's commercial-use banner */
  banner?: ReactNode;
  children?: ReactNode;
}

/**
 * A settings tab: its heading and description, then an optional banner, then its content, each
 * the same fixed distance below the last. A banner that renders nothing takes no space, so the
 * content sits where it would without one.
 */
export function SettingsPage({ title, description, actions, banner, children }: SettingsPageProps) {
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading>{title}</Heading>
          {description != null && <p className="text-text-subtle">{description}</p>}
        </div>
        {actions}
      </div>
      {banner != null && (
        // Hidden when nothing inside has content: a banner that renders null, or only an empty
        // wrapper (the client's commercial-use banner once dismissed)
        <div className="mt-6 [&:not(:has(:not(:empty)))]:hidden">{banner}</div>
      )}
      {children != null && <div className="mt-6">{children}</div>}
    </div>
  );
}
