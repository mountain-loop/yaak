import { useCallback } from "react";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { showDialog } from "../lib/dialog";

export function useCreateWorkspace() {
  return useCallback(() => {
    showDialog({
      id: "create-workspace",
      title: "Создать рабочее пространство",
      size: "sm",
      render: ({ hide }) => <CreateWorkspaceDialog hide={hide} />,
    });
  }, []);
}
