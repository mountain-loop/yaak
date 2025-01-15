import { open } from '@tauri-apps/plugin-dialog';
import classNames from 'classnames';
import mime from 'mime';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';

type Props = Omit<ButtonProps, 'type'> & {
  onChange: (value: { filePath: string | null; contentType: string | null }) => void;
  filePath: string | null;
  directory?: boolean;
  inline?: boolean;
  noun?: string;
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
    <HStack className="group relative justify-stretch overflow-hidden">
      <Button
        className={classNames(className, 'font-mono text-xs rtl mr-1.5', inline && 'w-full')}
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
              'font-mono truncate rtl pl-1.5 pr-3 text-text',
              size === 'xs' && 'text-xs',
              size === 'sm' && 'text-sm',
            )}
          >
            {rtlEscapeChar}
            {filePath ?? `No ${itemLabel.toLowerCase()} selected`}
          </div>
        </>
      )}
    </HStack>
  );
}
