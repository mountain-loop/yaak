import type { DivergedStrategy } from "@yaakapp-internal/git";
import { useState } from "react";
import { showDialog } from "../../lib/dialog";
import { Button } from "../core/Button";
import { InlineCode } from "../core/InlineCode";
import { RadioCards } from "../core/RadioCards";
import { HStack } from "../core/Stacks";

type Resolution = "force_reset" | "merge";

const resolutionLabel: Record<Resolution, string> = {
  force_reset: "Принудительный pull",
  merge: "Слияние",
};

interface DivergedDialogProps {
  remote: string;
  branch: string;
  onResult: (strategy: DivergedStrategy) => void;
  onHide: () => void;
}

function DivergedDialog({ remote, branch, onResult, onHide }: DivergedDialogProps) {
  const [selected, setSelected] = useState<Resolution | null>(null);

  const handleSubmit = () => {
    if (selected == null) return;
    onResult(selected);
    onHide();
  };

  const handleCancel = () => {
    onResult("cancel");
    onHide();
  };

  return (
    <div className="flex flex-col gap-4 mb-4">
      <p className="text-text-subtle">
        Your local branch has diverged from{" "}
        <InlineCode>
          {remote}/{branch}
        </InlineCode>
        . How would you like to resolve this?
      </p>
      <RadioCards
        name="diverged-strategy"
        value={selected}
        onChange={setSelected}
        options={[
          {
            value: "merge",
            label: "Коммит слияния",
            description: "Объединить локальные и удалённые изменения в один коммит слияния",
          },
          {
            value: "force_reset",
            label: "Принудительный pull",
            description: "Отбросить локальные коммиты и сбросить состояние до удалённой ветки",
          },
        ]}
      />
      <HStack space={2} justifyContent="start" className="flex-row-reverse">
        <Button
          color={selected === "force_reset" ? "danger" : "primary"}
          disabled={selected == null}
          onClick={handleSubmit}
        >
          {selected != null ? resolutionLabel[selected] : "Выберите вариант"}
        </Button>
        <Button variant="border" onClick={handleCancel}>
          Отмена
        </Button>
      </HStack>
    </div>
  );
}

export async function promptDivergedStrategy({
  remote,
  branch,
}: {
  remote: string;
  branch: string;
}): Promise<DivergedStrategy> {
  return new Promise((resolve) => {
    showDialog({
      id: "git-diverged",
      title: "Ветки разошлись",
      hideX: true,
      size: "sm",
      disableBackdropClose: true,
      onClose: () => resolve("cancel"),
      render: ({ hide }) =>
        DivergedDialog({
          remote,
          branch,
          onHide: hide,
          onResult: resolve,
        }),
    });
  });
}
