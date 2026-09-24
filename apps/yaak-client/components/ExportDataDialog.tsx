import type { Workspace } from "@yaakapp-internal/models";
import { workspacesAtom } from "@yaakapp-internal/models";
import { VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import slugify from "slugify";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { pluralizeCount } from "../lib/pluralize";
import { rpc } from "../lib/rpc";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { Checkbox } from "./core/Checkbox";
import { DetailsBanner } from "./core/DetailsBanner";
import { DialogFooter } from "./core/Dialog";
import { Link } from "./core/Link";
import { platform } from "@yaakapp-internal/platform";

interface Props {
  onHide: () => void;
  onSuccess: (path: string) => void;
}

export function ExportDataDialog({ onHide, onSuccess }: Props) {
  const allWorkspaces = useAtomValue(workspacesAtom);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  if (activeWorkspace == null || allWorkspaces.length === 0) return null;

  return (
    <ExportDataDialogContent
      onHide={onHide}
      onSuccess={onSuccess}
      allWorkspaces={allWorkspaces}
      activeWorkspace={activeWorkspace}
    />
  );
}

function ExportDataDialogContent({
  onHide,
  onSuccess,
  activeWorkspace,
  allWorkspaces,
}: Props & {
  allWorkspaces: Workspace[];
  activeWorkspace: Workspace;
}) {
  const [includePrivateEnvironments, setIncludePrivateEnvironments] = useState<boolean>(false);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Record<string, boolean>>({
    [activeWorkspace.id]: true,
  });

  // Put the active workspace first
  const workspaces = useMemo(
    () => [activeWorkspace, ...allWorkspaces.filter((w) => w.id !== activeWorkspace.id)],
    [activeWorkspace, allWorkspaces],
  );

  const handleToggleAll = () => {
    setSelectedWorkspaces(
      // oxlint-disable-next-line no-accumulating-spread
      allSelected ? {} : workspaces.reduce((acc, w) => ({ ...acc, [w.id]: true }), {}),
    );
  };

  const handleExport = useCallback(async () => {
    const ids = Object.keys(selectedWorkspaces).filter((k) => selectedWorkspaces[k]);
    const workspace = ids.length === 1 ? workspaces.find((w) => w.id === ids[0]) : undefined;
    const slug = workspace ? slugify(workspace.name, { lower: true }) : "workspaces";
    const document = await rpc<string>("cmd_export_data", {
      workspaceIds: ids,
      includePrivateEnvironments: includePrivateEnvironments,
    });

    const savedTo = await platform.files.save(
      `yaak.${slug}.json`,
      new TextEncoder().encode(document),
      [{ name: "JSON", extensions: ["json"] }],
    );
    if (savedTo == null) {
      return; // Cancelled
    }

    onHide();
    onSuccess(savedTo);
  }, [includePrivateEnvironments, onHide, onSuccess, selectedWorkspaces, workspaces]);

  const allSelected = workspaces.every((w) => selectedWorkspaces[w.id]);
  const numSelected = Object.values(selectedWorkspaces).filter(Boolean).length;
  const noneSelected = numSelected === 0;
  return (
    <>
      <VStack space={3} className="pb-4">
        <CommercialUseBanner source="data-export" title="Exporting work data?" />

        <table className="w-full mb-auto min-w-full max-w-full divide-y divide-surface-highlight">
          <thead>
            <tr>
              <th className="w-6 min-w-0 py-2 text-left pl-1">
                <Checkbox
                  checked={!allSelected && !noneSelected ? "indeterminate" : allSelected}
                  hideLabel
                  title="All workspaces"
                  onChange={handleToggleAll}
                />
              </th>
              <th className="py-2 text-left pl-4" onClick={handleToggleAll}>
                Workspace
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-highlight">
            {workspaces.map((w) => (
              <tr key={w.id}>
                <td className="min-w-0 py-1 pl-1">
                  <Checkbox
                    checked={selectedWorkspaces[w.id] ?? false}
                    title={w.name}
                    hideLabel
                    onChange={() =>
                      setSelectedWorkspaces((prev) => ({ ...prev, [w.id]: !prev[w.id] }))
                    }
                  />
                </td>
                <td
                  className="py-1 pl-4 text whitespace-nowrap overflow-x-auto hide-scrollbars"
                  onClick={() =>
                    setSelectedWorkspaces((prev) => ({ ...prev, [w.id]: !prev[w.id] }))
                  }
                >
                  {w.name} {w.id === activeWorkspace.id ? "(current workspace)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <DetailsBanner color="secondary" defaultOpen summary="Extra Settings">
          <Checkbox
            checked={includePrivateEnvironments}
            onChange={setIncludePrivateEnvironments}
            title="Include private environments"
            help='Environments marked as "sharable" will be exported by default'
          />
        </DetailsBanner>
      </VStack>
      <DialogFooter
        leftSlot={
          <Link href="https://yaak.app/button/new" noUnderline className="text-text-subtlest">
            Create Run Button
          </Link>
        }
        actions={[
          { label: "Cancel", onClick: onHide },
          {
            label: `Export ${pluralizeCount("Workspace", numSelected, { omitSingle: true, noneWord: "Nothing" })}`,
            color: "primary",
            disabled: noneSelected,
            onClick: () => handleExport(),
          },
        ]}
      />
    </>
  );
}
