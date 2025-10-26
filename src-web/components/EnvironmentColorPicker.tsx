import { useState } from 'react';
import { ColorIndicator } from './ColorIndicator';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { ColorPickerWithThemeColors } from './core/ColorPicker';

export function EnvironmentColorPicker({
  color: defaultColor,
  onChange,
}: {
  color: string | null;
  onChange: (color: string | null) => void;
}) {
  const [color, setColor] = useState<string | null>(defaultColor);
  return (
    <form
      className="flex flex-col items-stretch gap-5 pb-2 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(color);
      }}
    >
      <Banner color="secondary">
        This color will be used to color the interface when this environment is active
      </Banner>
      <ColorPickerWithThemeColors color={color} onChange={setColor} />
      <Button type="submit" color="secondary">
        {color != null && <ColorIndicator color={color} />}
        Save
      </Button>
    </form>
  );
}
