import { linter } from "@codemirror/lint";
import { useCallback, useMemo } from "react";
import { textLikelyContainsJsonComments } from "../../lib/jsonComments";
import { replaceTemplateTags } from "../../lib/templateTags";
import { Banner } from "../Banner";
import type { DropdownItem } from "../Dropdown";
import { Dropdown } from "../Dropdown";
import type { HostEditorProps } from "../EditorHost";
import { useEditorHost } from "../EditorHost";
import { jsonParseLinter } from "../editor/json-lint";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { IconTooltip } from "../IconTooltip";

interface Props {
  forceUpdateKey: string;
  heightMode: HostEditorProps["heightMode"];
  /** The request's id, keeping each request's editor state apart */
  requestId: string;
  text: string;
  /** JSON is sent as written, comments and all, instead of cleaned up first */
  sendJsonComments: boolean;
  onChange?: (text: string) => void;
  onChangeSendJsonComments?: (sendJsonComments: boolean) => void;
  /** Where dismissing the comments notice is remembered, like the workspace it applies to */
  noticeStorageKey: string;
  /** Show the body without a way to change it */
  readOnly?: boolean;
}

export function JsonBodyEditor({
  forceUpdateKey,
  heightMode,
  requestId,
  text,
  sendJsonComments,
  onChange,
  onChangeSendJsonComments,
  noticeStorageKey,
  readOnly,
}: Props) {
  const { Editor, useStoredValue } = useEditorHost();
  const autoFix = sendJsonComments !== true;

  const lintExtension = useMemo(
    () =>
      linter(
        jsonParseLinter(
          autoFix || readOnly
            ? { allowComments: true, allowTrailingCommas: true, escape: escapeTemplateTags }
            : { allowComments: false, allowTrailingCommas: false, escape: escapeTemplateTags },
        ),
      ),
    [autoFix, readOnly],
  );

  const hasComments = useMemo(() => textLikelyContainsJsonComments(text), [text]);

  const [bannerDismissed, setBannerDismissed] = useStoredValue<boolean>(
    ["json-fix-3", noticeStorageKey],
    false,
    "no_sync",
  );

  const handleToggleAutoFix = useCallback(
    () => onChangeSendJsonComments?.(autoFix),
    [autoFix, onChangeSendJsonComments],
  );

  const handleDropdownOpen = useCallback(() => {
    if (!bannerDismissed) {
      Promise.resolve(setBannerDismissed(true)).catch(console.error);
    }
  }, [bannerDismissed, setBannerDismissed]);

  const showBanner = hasComments && autoFix && !bannerDismissed;

  const stripMessage = "Automatically strip comments and trailing commas before sending";
  const actions = useMemo<HostEditorProps["actions"]>(
    () =>
      readOnly
        ? undefined
        : [
            showBanner && (
              <Banner
                color="notice"
                className="opacity-100! h-sm py-0! px-2! flex items-center text-xs"
              >
                <p className="inline-flex items-center gap-1 min-w-0">
                  <span className="truncate">Auto-fix enabled</span>
                  <Icon icon="arrow_right" size="sm" className="opacity-disabled" />
                </p>
              </Banner>
            ),
            <div key="settings" className="opacity-100! shadow!">
              <Dropdown
                onOpen={handleDropdownOpen}
                items={
                  [
                    {
                      label: "Automatically Fix JSON",
                      keepOpenOnSelect: true,
                      onSelect: handleToggleAutoFix,
                      rightSlot: <IconTooltip content={stripMessage} />,
                      leftSlot: (
                        <Icon icon={autoFix ? "check_square_checked" : "check_square_unchecked"} />
                      ),
                    },
                  ] satisfies DropdownItem[]
                }
              >
                <IconButton size="sm" variant="border" icon="settings" title="JSON Settings" />
              </Dropdown>
            </div>,
          ],
    [handleDropdownOpen, handleToggleAutoFix, autoFix, readOnly, showBanner],
  );

  return (
    <Editor
      forceUpdateKey={forceUpdateKey}
      autocompleteFunctions
      autocompleteVariables
      placeholder="..."
      heightMode={heightMode}
      defaultValue={text}
      language="json"
      onChange={onChange}
      readOnly={readOnly}
      stateKey={`json.${requestId}`}
      actions={actions}
      lintExtension={lintExtension}
    />
  );
}

// We need lint to not break on stuff like {"foo:" ${[ ... ]}} so we'll replace all template
// syntax with repeating `1` characters, so it's valid JSON and the position is still correct.
function escapeTemplateTags(doc: string): string {
  return replaceTemplateTags(doc, (m) => "1".repeat(m.end - m.start));
}
