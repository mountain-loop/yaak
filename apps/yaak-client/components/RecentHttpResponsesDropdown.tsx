import type { HttpResponse } from "@yaakapp-internal/models";
import { deleteModel } from "@yaakapp-internal/models";
import { HStack, Icon } from "@yaakapp-internal/ui";
import {
  differenceInHours,
  differenceInMinutes,
  format,
  isToday,
  isYesterday,
} from "date-fns";
import { useDeleteHttpResponses } from "../hooks/useDeleteHttpResponses";
import { useKeyValue } from "../hooks/useKeyValue";
import { DismissibleBanner } from "./core/DismissibleBanner";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { formatMillis } from "./core/HttpResponseDurationTag";
import { HttpStatusTag } from "./core/HttpStatusTag";
import { IconButton } from "./core/IconButton";
import { SizeTag } from "./core/SizeTag";

interface Props {
  responses: HttpResponse[];
  activeResponse: HttpResponse;
  onPinnedResponseId: (id: string) => void;
  className?: string;
}

export const RecentHttpResponsesDropdown = function ResponsePane({
  activeResponse,
  responses,
  onPinnedResponseId,
}: Props) {
  const deleteAllResponses = useDeleteHttpResponses(activeResponse?.requestId);
  const movedActionsBannerId = "response-actions-moved-to-response-menu-2026-07-02-v2";
  const { value: dismissedMovedActions } = useKeyValue<boolean>({
    namespace: "global",
    key: ["dismiss-banner", movedActionsBannerId],
    fallback: false,
  });
  const latestResponseId = responses[0]?.id ?? "n/a";
  const responseHistoryItems: DropdownItem[] = [];
  let lastHistoryGroup: string | null = null;
  let hasRecentResponses = false;
  let hasShownRecentEmptyState = false;
  const now = new Date();

  for (const r of responses) {
    const createdAt = `${r.createdAt}Z`;
    const createdAtDate = new Date(createdAt);
    const minutesAgo = differenceInMinutes(now, createdAtDate);
    const hoursAgo = differenceInHours(now, createdAtDate);
    let historyGroup = format(createdAtDate, "MMM d, yyyy");
    if (minutesAgo < 5) historyGroup = "Just now";
    else if (minutesAgo < 15) historyGroup = "5 minutes ago";
    else if (minutesAgo < 60) historyGroup = "15 minutes ago";
    else if (hoursAgo < 3) historyGroup = "1 hour ago";
    else if (hoursAgo < 6) historyGroup = "3 hours ago";
    else if (isToday(createdAtDate)) historyGroup = "Today";
    else if (isYesterday(createdAtDate)) historyGroup = "Yesterday";
    else if (createdAtDate.getFullYear() === now.getFullYear()) historyGroup = format(createdAtDate, "MMM d");
    const absoluteTime = format(createdAt, "MMM d, yyyy, h:mm:ss a O");

    if (historyGroup === "Just now") {
      hasRecentResponses = true;
    } else if (!hasRecentResponses && !hasShownRecentEmptyState) {
      responseHistoryItems.push({
        type: "content",
        label: <span className="block px-4 py-1 text-sm text-text-subtle">No recent requests</span>,
      });
      hasShownRecentEmptyState = true;
    }

    if (historyGroup !== "Just now" && historyGroup !== lastHistoryGroup) {
      responseHistoryItems.push({
        type: "separator",
        label: <span title={absoluteTime}>{historyGroup}</span>,
      });
      lastHistoryGroup = historyGroup;
    }

    responseHistoryItems.push({
      label: (
        <HStack space={2} className="text-sm" title={absoluteTime}>
          <HttpStatusTag short className="text-xs" response={r} />
          <span className="text-text-subtlest">&bull;</span>
          <span className="font-mono">{r.elapsed >= 0 ? formatMillis(r.elapsed) : "n/a"}</span>
          <span className="text-text-subtlest">&bull;</span>
          <SizeTag
            className="text-xs"
            contentLength={r.contentLength ?? 0}
            contentLengthCompressed={r.contentLengthCompressed}
          />
        </HStack>
      ),
      leftSlot: activeResponse?.id === r.id ? <Icon icon="check" /> : <Icon icon="empty" />,
      onSelect: () => onPinnedResponseId(r.id),
    });
  }

  if (!hasRecentResponses && !hasShownRecentEmptyState) {
    responseHistoryItems.push({
      type: "content",
      label: <span className="block px-4 py-1 text-sm text-text-subtle">No recent requests</span>,
    });
  }

  return (
    <Dropdown
      items={[
        {
          label: "Delete",
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteModel(activeResponse),
        },
        {
          label: "Delete all",
          leftSlot: <Icon icon="trash" />,
          onSelect: deleteAllResponses.mutate,
          disabled: responses.length === 0,
        },
        {
          label: "Unpin Response",
          onSelect: () => onPinnedResponseId(activeResponse.id),
          leftSlot: <Icon icon="unpin" />,
          hidden: latestResponseId === activeResponse.id,
          disabled: responses.length === 0,
        },
        {
          type: "content",
          hidden: dismissedMovedActions === true,
          label: (
            <DismissibleBanner
              id={movedActionsBannerId}
              color="info"
              size="xs"
              className="max-w-72"
            >
              <p>Copy and save actions moved to the Response tab menu.</p>
            </DismissibleBanner>
          ),
        },
        {
          type: "separator",
          label: "Recent",
        },
        ...responseHistoryItems,
      ]}
    >
      <IconButton
        title="Show response history"
        icon={activeResponse?.id === latestResponseId ? "history" : "pin"}
        className="m-0.5 text-text-subtle"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
};
