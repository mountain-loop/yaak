import { type ReactNode, useMemo } from "react";
import { useToggle } from "../../hooks/useToggle";
import { isProbablyTextContentType } from "../../lib/mimeType";
import { Banner } from "../Banner";
import { Button } from "../Button";
import { InlineCode } from "../InlineCode";
import { HStack } from "../Stacks";
import { SizeTag } from "../tags/SizeTag";

interface Props {
  children: ReactNode;
  /** Bytes of the body being guarded */
  contentLength: number | null;
  contentType: string | null;
  /** What's being shown, in the notice: "responses" or "content" */
  noun?: string;
  /** The reveal button's label */
  revealLabel?: string;
  /** Save the body to a file, when the app can */
  onSave?: () => void;
  /** Read the body as text for copying, when the app can */
  getText?: () => Promise<string | null>;
  /** The copy button, rendered by the app so it reports the copy its own way */
  renderCopyButton?: (getText: () => Promise<string | null>) => ReactNode;
}

/** Bytes above which a body is held back until asked for, and opens raw once shown */
export const LARGE_BODY_BYTES = 2 * 1000 * 1000;

/** Holds back a body big enough to slow the window down, until asked to show it */
export function ConfirmLargeResponse({
  children,
  contentLength,
  contentType,
  noun = "responses",
  revealLabel = "Reveal Response",
  onSave,
  getText,
  renderCopyButton,
}: Props) {
  const [showLargeResponse, toggleShowLargeResponse] = useToggle();
  const isProbablyText = useMemo(() => isProbablyTextContentType(contentType), [contentType]);

  const isLarge = (contentLength ?? 0) > LARGE_BODY_BYTES;
  if (!showLargeResponse && isLarge) {
    return (
      <Banner color="primary" className="flex flex-col gap-3">
        <p>
          Showing {noun} over{" "}
          <InlineCode>
            <SizeTag contentLength={LARGE_BODY_BYTES} />
          </InlineCode>{" "}
          may impact performance
        </p>
        <HStack wrap space={2}>
          <Button color="primary" size="xs" onClick={toggleShowLargeResponse}>
            {revealLabel}
          </Button>
          {onSave != null && (
            <Button color="secondary" variant="border" size="xs" onClick={onSave}>
              Save to File
            </Button>
          )}
          {isProbablyText && getText != null && renderCopyButton?.(getText)}
        </HStack>
      </Banner>
    );
  }

  return <>{children}</>;
}
