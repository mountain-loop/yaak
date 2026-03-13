import { linter } from "@codemirror/lint";
import type { HttpRequest } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { useCallback, useMemo } from "react";
import { fireAndForget } from "../lib/fireAndForget";
import { useKeyValue } from "../hooks/useKeyValue";
import { textLikelyContainsJsonComments } from "../lib/jsonComments";
import { Banner } from "./core/Banner";
import type { DropdownItem } from "./core/Dropdown";
import { Dropdown } from "./core/Dropdown";
import type { EditorProps } from "./core/Editor/Editor";
import { jsonParseLinter } from "./core/Editor/json-lint";
import { Editor } from "./core/Editor/LazyEditor";
import { Icon } from "./core/Icon";
import { IconButton } from "./core/IconButton";
import { IconTooltip } from "./core/IconTooltip";

interface Props {
  forceUpdateKey: string;
  heightMode: EditorProps["heightMode"];
  request: HttpRequest;
}

export function JsonBodyEditor({ forceUpdateKey, heightMode, request }: Props) {
  const handleChange = useCallback(
    (text: string) => patchModel(request, { body: { ...request.body, text } }),
    [request],
  );

  const autoFix = request.body?.sendJsonComments !== true;

  const lintExtension = useMemo(
    () =>
      linter(
        jsonParseLinter(
          autoFix
            ? { allowComments: true, allowTrailingCommas: true }
            : { allowComments: false, allowTrailingCommas: false },
        ),
      ),
    [autoFix],
  );

  const hasComments = useMemo(
    () => textLikelyContainsJsonComments(request.body?.text ?? ""),
    [request.body?.text],
  );

  const { value: bannerDismissed, set: setBannerDismissed } = useKeyValue<boolean>({
    namespace: "no_sync",
    key: ["json-fix-3", request.workspaceId],
    fallback: false,
  });

  const handleToggleAutoFix = useCallback(() => {
    const newBody = { ...request.body };
    if (autoFix) {
      newBody.sendJsonComments = true;
    } else {
      delete newBody.sendJsonComments;
    }
    fireAndForget(patchModel(request, { body: newBody }));
  }, [request, autoFix]);

  const handleDropdownOpen = useCallback(() => {
    if (!bannerDismissed) {
      fireAndForget(setBannerDismissed(true));
    }
  }, [bannerDismissed, setBannerDismissed]);

  const showBanner = hasComments && autoFix && !bannerDismissed;

  const stripMessage = "Automatically strip comments and trailing commas before sending";
  const actions = useMemo<EditorProps["actions"]>(
    () => [
      showBanner && (
        <Banner color="notice" className="!opacity-100 h-sm !py-0 !px-2 flex items-center text-xs">
          <p className="inline-flex items-center gap-1 min-w-0">
            <span className="truncate">Auto-fix enabled</span>
            <Icon icon="arrow_right" size="sm" className="opacity-disabled" />
          </p>
        </Banner>
      ),
      <div key="settings" className="!opacity-100 !shadow">
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
    [handleDropdownOpen, handleToggleAutoFix, autoFix, showBanner],
  );

  return (
    <Editor
      forceUpdateKey={forceUpdateKey}
      autocompleteFunctions
      autocompleteVariables
      placeholder="..."
      heightMode={heightMode}
      defaultValue={`${request.body?.text ?? ""}`}
      language="json"
      onChange={handleChange}
      stateKey={`json.${request.id}`}
      actions={actions}
      lintExtension={lintExtension}
    />
  );
}
