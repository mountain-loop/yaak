import { createWorkspaceModel } from "@yaakapp-internal/models";
import { useRef, useState } from "react";
import { useToggle } from "../hooks/useToggle";
import { generateId } from "../lib/generateId";
import { ColorIndicator } from "./ColorIndicator";
import { Checkbox } from "./core/Checkbox";
import { ColorPickerWithThemeColors } from "./core/ColorPicker";
import { DialogFooter } from "./core/Dialog";
import { Label } from "./core/Label";
import { PlainInput } from "./core/PlainInput";

interface Props {
  onCreate: (id: string) => void;
  hide: () => void;
  workspaceId: string;
}

export function CreateEnvironmentDialog({ workspaceId, hide, onCreate }: Props) {
  const [name, setName] = useState<string>("");
  const [color, setColor] = useState<string | null>(null);
  const [sharable, toggleSharable] = useToggle(false);
  const formId = useRef(`create-environment.form.${generateId()}`).current;
  return (
    <form
      id={formId}
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const id = await createWorkspaceModel({
          model: "environment",
          name,
          color,
          variables: [],
          public: sharable,
          workspaceId,
          parentModel: "environment",
        });
        hide();
        onCreate(id);
      }}
    >
      <PlainInput
        label="Name"
        required
        defaultValue={name}
        onChange={setName}
        placeholder="Production"
      />
      <Checkbox
        checked={sharable}
        title="Share this environment"
        help="Sharable environments are included in data export and directory sync."
        onChange={toggleSharable}
      />
      <div>
        <Label
          htmlFor="color"
          className="mb-1.5"
          help="Select a color to be displayed when this environment is active, to help identify it."
        >
          Color
        </Label>
        <ColorPickerWithThemeColors onChange={setColor} color={color} />
      </div>
      <DialogFooter
        inline
        actions={[
          {
            label: "Create Environment",
            color: "secondary",
            variant: "solid",
            form: formId,
            leftSlot: color != null ? <ColorIndicator color={color} /> : undefined,
          },
        ]}
      />
    </form>
  );
}
