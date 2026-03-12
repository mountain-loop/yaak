import type { ActionInvocation } from '@yaakapp-internal/proxy-lib';
import { IconButton, type IconButtonProps } from '@yaakapp-internal/ui';
import { useCallback } from 'react';
import { useRpcMutation } from '../hooks/useRpcMutation';
import { useActionMetadata } from '../hooks/useActionMetadata';

type ActionIconButtonProps = Omit<IconButtonProps, 'onClick' | 'title'> & {
  action: ActionInvocation;
  title?: string;
};

export function ActionIconButton({ action, ...props }: ActionIconButtonProps) {
  const meta = useActionMetadata(action);
  const { mutate, isPending } = useRpcMutation('execute_action');

  const onClick = useCallback(() => {
    mutate(action);
  }, [action, mutate]);

  return (
    <IconButton
      {...props}
      title={props.title ?? meta?.label ?? '…'}
      disabled={props.disabled || isPending}
      isLoading={isPending}
      onClick={onClick}
    />
  );
}
