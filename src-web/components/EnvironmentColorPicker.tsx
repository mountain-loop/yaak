import { useState } from 'react';
import { Button } from './core/Button';
import { ColorPicker } from './core/ColorPicker';

export function EnvironmentColorPicker({
  color: defaultColor,
  onChange,
}: {
  color: string | null;
  onChange: (color: string | null) => void;
}) {
  const [color, setColor] = useState<string | null>(defaultColor);
  return (
    <div className="flex flex-col items-stretch gap-3 pb-2 w-full">
      <ColorPicker color={color} onChange={setColor} />
      <div className="grid grid-cols-[1fr_1fr] gap-1.5">
        <Button variant="border" color="secondary" onClick={() => onChange(null)}>
          Clear
        </Button>
        <Button color="primary" onClick={() => onChange(color)}>
          Save
        </Button>
      </div>
    </div>
  );
}
