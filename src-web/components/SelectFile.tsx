import { open } from '@tauri-apps/plugin-dialog';
import classNames from 'classnames';
import mime from 'mime';
import type { ReactNode } from 'react';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { IconTooltip } from './core/IconTooltip';
import { Label } from './core/Label';
import { HStack } from './core/Stacks';

type Props = Omit<ButtonProps, 'type'> & {
  onChange: (value: { filePath: string | null; contentType: string | null }) => void;
  filePath: string | null;
  directory?: boolean;
  inline?: boolean;
  noun?: string;
  help?: ReactNode;
  label?: ReactNode;
};

// Special character to insert ltr text in rtl element
const rtlEscapeChar = <>&#x200E;</>;

export function SelectFile({
  onChange,
  filePath,
  inline,
  className,
  directory,
  noun,
  size = 'sm',
  label,
  help,
  ...props
}: Props) {
  const handleClick = async () => {
    const filePath = await open({
      title: directory ? 'Select Folder' : 'Select File',
      multiple: false,
      directory,
    });
    if (filePath == null) return;
    const contentType = filePath ? mime.getType(filePath) : null;
    onChange({ filePath, contentType });
  };

  const handleClear = async () => {
    onChange({ filePath: null, contentType: null });
  };

  const itemLabel = noun ?? (directory ? 'Folder' : 'File');
  const selectOrChange = (filePath ? 'Change ' : 'Select ') + itemLabel;

  return (
    <div>
      {label && (
        <Label htmlFor={null} help={help}>
          {label}
        </Label>
      )}
      <HStack className="relative justify-stretch overflow-hidden">
        <Button
          className={classNames(
            className,
            'rtl mr-1.5',
            inline && 'w-full',
            filePath && inline && 'font-mono text-xs',
          )}
          color="secondary"
          onClick={handleClick}
          size={size}
          {...props}
        >
          {rtlEscapeChar}
          {inline ? filePath || selectOrChange : selectOrChange}
        </Button>

        {!inline && (
          <>
            {filePath && (
              <IconButton
                size={size}
                variant="border"
                icon="x"
                title={'Unset ' + itemLabel}
                onClick={handleClear}
              />
            )}
            <div
              className={classNames(
                'truncate rtl pl-1.5 pr-3 text-text',
                filePath && 'font-mono',
                size === 'xs' && filePath && 'text-xs',
                size === 'sm' && filePath && 'text-sm',
              )}
            >
              {rtlEscapeChar}
              {filePath ?? `No ${itemLabel.toLowerCase()} selected`}
            </div>
            {filePath == null && help && !label && <IconTooltip content={help} />}
          </>
        )}
      </HStack>
    </div>
  );
}
