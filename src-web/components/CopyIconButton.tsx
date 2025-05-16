import { useTimedBoolean } from '../hooks/useTimedBoolean';
import { copyToClipboard } from '../lib/copy';
import { showToast } from '../lib/toast';
import type { IconButtonProps } from './core/IconButton';
import { IconButton } from './core/IconButton';

interface Props extends Omit<IconButtonProps, 'onClick' | 'icon'> {
  text: string | (() => Promise<string | null>);
}

export function CopyIconButton({ text, ...props }: Props) {
  const [copied, setCopied] = useTimedBoolean();
  return (
    <IconButton
      {...props}
      icon={copied ? 'check' : 'copy'}
      showConfirm
      onClick={async () => {
        const content = typeof text === 'function' ? await text() : text;
        if (content == null) {
          showToast({
            id: 'failed-to-copy',
            color: 'danger',
            message: 'Failed to copy',
          });
        } else {
          copyToClipboard(content, { disableToast: true });
          setCopied();
        }
      }}
    />
  );
}
