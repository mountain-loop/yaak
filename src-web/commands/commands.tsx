import { createWorkspaceModel, type Folder, modelTypeLabel } from "@yaakapp-internal/models";
import { applySync, calculateSync } from "@yaakapp-internal/sync";
import { Banner } from "../components/core/Banner";
import { Button } from "../components/core/Button";
import { InlineCode } from "../components/core/InlineCode";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from "../components/core/Table";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { showDialog } from "../lib/dialog";
import { jotaiStore } from "../lib/jotai";
import { showPrompt } from "../lib/prompt";
import { resolvedModelNameWithFolders } from "../lib/resolvedModelName";

function countFilesRu(count: number): string {
  return `${count} ${count === 1 ? "файл" : "файлов"}`;
}

export const createFolder = createFastMutation<
  string | null,
  void,
  Partial<Pick<Folder, "name" | "sortPriority" | "folderId">>
>({
  mutationKey: ["create_folder"],
  mutationFn: async (patch) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) {
      throw new Error("Cannot create folder when there's no active workspace");
    }

    if (!patch.name) {
      const name = await showPrompt({
        id: "new-folder",
        label: "Название",
        defaultValue: "Папка",
        title: "Новая папка",
        confirmText: "Создать",
        placeholder: "Название",
      });
      if (name == null) return null;

      patch.name = name;
    }

    patch.sortPriority = patch.sortPriority || -Date.now();
    const id = await createWorkspaceModel({ model: "folder", workspaceId, ...patch });
    return id;
  },
});

export const syncWorkspace = createFastMutation<
  void,
  void,
  { workspaceId: string; syncDir: string; force?: boolean }
>({
  mutationKey: [],
  mutationFn: async ({ workspaceId, syncDir, force }) => {
    const ops = (await calculateSync(workspaceId, syncDir)) ?? [];
    if (ops.length === 0) {
      console.log("Nothing to sync", workspaceId, syncDir);
      return;
    }
    console.log("Syncing workspace", workspaceId, syncDir, ops);

    const dbOps = ops.filter((o) => o.type.startsWith("db"));

    if (dbOps.length === 0) {
      await applySync(workspaceId, syncDir, ops);
      return;
    }

    const isDeletingWorkspace = ops.some(
      (o) => o.type === "dbDelete" && o.model.model === "workspace",
    );

    console.log("Directory changes detected", { dbOps, ops });

    if (force) {
      await applySync(workspaceId, syncDir, ops);
      return;
    }

    showDialog({
      id: "commit-sync",
      title: "Обнаружены изменения",
      size: "md",
      render: ({ hide }) => (
        <form
          className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await applySync(workspaceId, syncDir, ops);
            hide();
          }}
        >
          {isDeletingWorkspace ? (
            <Banner color="danger">
              🚨 <strong>Изменения содержат удаление рабочего пространства!</strong>
            </Banner>
          ) : (
            <span />
          )}
          <p>
            {countFilesRu(dbOps.length)} в каталоге{" "}
            {dbOps.length === 1 ? "был изменен" : "были изменены"}.
            Хотите обновить рабочее пространство?
          </p>
          <Table scrollable className="my-4">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Тип</TableHeaderCell>
                <TableHeaderCell>Название</TableHeaderCell>
                <TableHeaderCell>Операция</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dbOps.map((op, i) => {
                let name: string;
                let label: string;
                let color: string;
                let model: string;

                if (op.type === "dbCreate") {
                  label = "создание";
                  name = resolvedModelNameWithFolders(op.fs.model);
                  color = "text-success";
                  model = modelTypeLabel(op.fs.model);
                } else if (op.type === "dbUpdate") {
                  label = "обновление";
                  name = resolvedModelNameWithFolders(op.fs.model);
                  color = "text-info";
                  model = modelTypeLabel(op.fs.model);
                } else if (op.type === "dbDelete") {
                  label = "удаление";
                  name = resolvedModelNameWithFolders(op.model);
                  color = "text-danger";
                  model = modelTypeLabel(op.model);
                } else {
                  return null;
                }

                return (
                  // oxlint-disable-next-line react/no-array-index-key
                  <TableRow key={i}>
                    <TableCell className="text-text-subtle">{model}</TableCell>
                    <TruncatedWideTableCell>{name}</TruncatedWideTableCell>
                    <TableCell className="text-right">
                      <InlineCode className={color}>{label}</InlineCode>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <footer className="py-3 flex flex-row-reverse items-center gap-3">
            <Button type="submit" color="primary">
              Применить изменения
            </Button>
            <Button onClick={hide} color="secondary">
              Отмена
            </Button>
          </footer>
        </form>
      ),
    });
  },
});
