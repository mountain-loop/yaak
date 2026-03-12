import type { ActionInvocation } from '@yaakapp-internal/proxy-lib';
import { Button, type ButtonProps } from '@yaakapp-internal/ui';
import { useCallback } from 'react';
import { useRpcMutation } from '../hooks/useRpcMutation';
import { useActionMetadata } from '../hooks/useActionMetadata';

type ActionButtonProps = Omit<ButtonProps, 'onClick' | 'children'> & {
  action: ActionInvocation;
  /** Override the label from metadata */
  children?: React.ReactNode;
};

export function ActionButton({ action, children, ...props }: ActionButtonProps) {
  const meta = useActionMetadata(action);
  const { mutate, isPending } = useRpcMutation('execute_action');

  const onClick = useCallback(() => {
    mutate(action);
  }, [action, mutate]);

  return (
    <Button
      {...props}
      disabled={props.disabled || isPending}
      isLoading={isPending}
      onClick={onClick}
    >
      {children ?? meta?.label ?? '…'}
    </Button>
  );
}
