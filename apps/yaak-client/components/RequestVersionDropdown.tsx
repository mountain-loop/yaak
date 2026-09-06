import type { HttpResponse, RequestVersionComparison } from "@yaakapp-internal/models";
import { Icon } from "@yaakapp-internal/ui";
import { stringify } from "yaml";
import { useRequestVersion } from "../hooks/useRequestVersion";
import { showDialog } from "../lib/dialog";
import { restoreRequestVersion } from "../lib/restoreRequestVersion";
import { Button } from "./core/Button";
import { DiffViewer } from "./core/Editor/DiffViewer";
import { Dropdown } from "./core/Dropdown";

interface Props {
  response: Pick<HttpResponse, "requestId" | "versionId">;
}

/**
 * Offers the request a response was sent from, when that is no longer the
 * request you have.
 *
 * Hidden while the two agree, which is the overwhelmingly common case and the
 * one where there is nothing to say. Responses recorded before versioning
 * existed have no version and stay quiet forever.
 */
export function RequestVersionDropdown({ response }: Props) {
  const comparison = useRequestVersion(response.versionId, response.requestId);
  if (comparison.data == null || !comparison.data.differs) {
    return null;
  }

  return (
    <Dropdown
      items={[
        {
          label: "View Diff",
          leftSlot: <Icon icon="git_branch" />,
          onSelect: () => showRequestVersionDiff(comparison.data!),
        },
        {
          label: "Restore This Version",
          leftSlot: <Icon icon="history" />,
          onSelect: () => restoreRequestVersion(comparison.data!.version),
        },
      ]}
    >
      <Button
        size="2xs"
        variant="border"
        color="notice"
        className="font-sans"
        title="This request has changed since this response was sent"
        forDropdown
      >
        Request Changed
      </Button>
    </Dropdown>
  );
}

function showRequestVersionDiff(comparison: RequestVersionComparison) {
  showDialog({
    id: "request-version-diff",
    title: "Request Changes Since This Response",
    size: "full",
    noPadding: true,
    render: () => (
      <div className="h-full flex flex-col px-4 pb-4">
        <DiffViewer
          original={toYaml(comparison.version.document)}
          modified={toYaml(comparison.currentDocument)}
          className="flex-1 min-h-0"
        />
      </div>
    ),
  });
}

/** Matches how the Git dialog renders a model for diffing. */
function toYaml(document: unknown): string {
  return stringify(document, { indent: 2, lineWidth: 0 });
}
