import type { Workspace } from "@yaakapp-internal/models";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { switchWorkspace } from "../commands/switchWorkspace";
import { Checkbox } from "./core/Checkbox";
import { DialogFooter } from "./core/Dialog";

interface Props {
  hide: () => void;
  workspace: Workspace;
}

export function SwitchWorkspaceDialog({ hide, workspace }: Props) {
  const settings = useAtomValue(settingsAtom);
  const [remember, setRemember] = useState<boolean>(false);

  const open = async (inNewWindow: boolean) => {
    hide();
    switchWorkspace.mutate({ workspaceId: workspace.id, inNewWindow });
    if (remember) {
      await patchModel(settings, { openWorkspaceNewWindow: inNewWindow });
    }
  };

  return (
    <VStack space={3}>
      <p>
        Where would you like to open <InlineCode>{workspace.name}</InlineCode>?
      </p>
      {settings && (
        <Checkbox checked={remember} title="Remember my choice" onChange={setRemember} />
      )}
      <DialogFooter
        inline
        actions={[
          {
            label: "New Window",
            rightSlot: <Icon icon="external_link" />,
            onClick: () => open(true),
          },
          { label: "This Window", color: "primary", autoFocus: true, onClick: () => open(false) },
        ]}
      />
    </VStack>
  );
}
