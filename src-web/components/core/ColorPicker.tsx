import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useRandomKey } from '../../hooks/useRandomKey';
import { PlainInput } from './PlainInput';

interface Props {
  onChange: (value: string | null) => void;
  color: string | null;
}

export function ColorPicker({ onChange, color: defaultColor }: Props) {
  const [updateKey, regenerateKey] = useRandomKey();
  const [color, setColor] = useState<string | null>(defaultColor);
  return (
    <form
      className="flex flex-col gap-3 items-stretch w-full"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(color);
      }}
    >
      <HexColorPicker
        color={color ?? undefined}
        className="!w-full"
        onChange={(color) => {
          setColor(color.toUpperCase());
          regenerateKey();
        }}
      />
      <PlainInput
        hideLabel
        label="Plain Color"
        forceUpdateKey={updateKey}
        defaultValue={color ?? ''}
        onChange={(c) => setColor(c.toUpperCase())}
        validate={(color) => color.match(/#[0-9a-fA-F]{6}$/) !== null}
      />
    </form>
  );
}
