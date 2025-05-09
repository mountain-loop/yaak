import { useTimedBoolean } from '../hooks/useTimedBoolean';
import { copyToClipboard } from '../lib/copy';
import { showToast } from '../lib/toast';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';

interface Props extends Omit<ButtonProps, 'onClick'> {
  text: string | (() => Promise<string | null>);
}

export function CopyButton({ text, ...props }: Props) {
  const [copied, setCopied] = useTimedBoolean();
  return (
    <Button
      {...props}
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
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
