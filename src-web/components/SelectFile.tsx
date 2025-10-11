import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import classNames from 'classnames';
import mime from 'mime';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
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
  const [isHovering, setIsHovering] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Listen for dropped files on the element
  // NOTE: This doesn't work for Windows since native drag-n-drop can't work at the same tmie
  //  as browser drag-n-drop.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      const webview = getCurrentWebviewWindow();
      unlisten = await webview.onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          const p = event.payload.position;
          const r = ref.current?.getBoundingClientRect();
          if (r == null) return;
          const isOver = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
          console.log('IS OVER', isOver);
          setIsHovering(isOver);
        } else if (event.payload.type === 'drop' && isHovering) {
          console.log('User dropped', event.payload.paths);
          const p = event.payload.paths[0];
          if (p) onChange({ filePath: p, contentType: null });
          setIsHovering(false);
        } else {
          console.log('File drop cancelled');
          setIsHovering(false);
        }
      });
    };
    setup().catch(console.error);
    return () => {
      if (unlisten) unlisten();
    };
  }, [isHovering, onChange]);

  return (
    <div ref={ref} className="w-full">
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
            isHovering && '!border-notice',
          )}
          color={isHovering ? 'primary' : 'secondary'}
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
                size={size === 'auto' ? 'md' : size}
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
