import { createWorkspaceModel } from '@yaakapp-internal/models';
import { useState } from 'react';
import { ColorIndicator } from './ColorIndicator';
import { Button } from './core/Button';
import { ColorPickerWithThemeColors } from './core/ColorPicker';
import { Label } from './core/Label';
import { PlainInput } from './core/PlainInput';

interface Props {
  onCreate: (id: string) => void;
  hide: () => void;
  workspaceId: string;
}

export function CreateEnvironmentDialog({ workspaceId, hide, onCreate }: Props) {
  const [name, setName] = useState<string>('');
  const [color, setColor] = useState<string | null>(null);
  return (
    <form
      className="pb-3 flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const id = await createWorkspaceModel({
          model: 'environment',
          name,
          color,
          variables: [],
          workspaceId,
          parentModel: 'environment',
        });
        hide();
        onCreate(id);
      }}
    >
      <PlainInput label="Name" required defaultValue={name} onChange={setName} placeholder="Production" />
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
      <Button type="submit" color="secondary" className="mt-3">
        {color != null && <ColorIndicator color={color} />}
        Create Environment
      </Button>
    </form>
  );
}
