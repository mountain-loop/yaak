import classNames from 'classnames';
import type { MouseEvent } from 'react';
import { forwardRef, useCallback } from 'react';
import { useTimedBoolean } from '../../hooks/useTimedBoolean';
import type { ButtonProps } from './Button';
import { Button } from './Button';
import type { IconProps } from './Icon';
import { Icon } from './Icon';
import { LoadingIcon } from './LoadingIcon';

export type IconButtonProps = IconProps &
  ButtonProps & {
    showConfirm?: boolean;
    iconClassName?: string;
    iconSize?: IconProps['size'];
    iconColor?: IconProps['color'];
    title: string;
    showBadge?: boolean;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    showConfirm,
    icon,
    color = 'default',
    spin,
    onClick,
    className,
    iconClassName,
    tabIndex,
    size = 'md',
    iconSize,
    showBadge,
    iconColor,
    isLoading,
    ...props
  }: IconButtonProps,
  ref,
) {
  const [confirmed, setConfirmed] = useTimedBoolean();
  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (showConfirm) setConfirmed();
      onClick?.(e);
    },
    [onClick, setConfirmed, showConfirm],
  );

  return (
    <Button
      ref={ref}
      aria-hidden={icon === 'empty'}
      disabled={icon === 'empty'}
      tabIndex={(tabIndex ?? icon === 'empty') ? -1 : undefined}
      onClick={handleClick}
      innerClassName="flex items-center justify-center"
      size={size}
      color={color}
      className={classNames(
        className,
        'group/button relative flex-shrink-0',
        '!px-0',
        size === 'md' && 'w-md',
        size === 'sm' && 'w-sm',
        size === 'xs' && 'w-xs',
        size === '2xs' && 'w-5',
      )}
      {...props}
    >
      {showBadge && (
        <div className="absolute top-0 right-0 w-1/2 h-1/2 flex items-center justify-center">
          <div className="w-2.5 h-2.5 bg-pink-500 rounded-full" />
        </div>
      )}
      {isLoading ? (
        <LoadingIcon size={iconSize} className={iconClassName} />
      ) : (
        <Icon
          size={iconSize}
          icon={confirmed ? 'check' : icon}
          spin={spin}
          color={iconColor}
          className={classNames(
            iconClassName,
            'group-hover/button:text-text',
            confirmed && '!text-success', // Don't use Icon.color here because it won't override the hover color
            props.disabled && 'opacity-70',
          )}
        />
      )}
    </Button>
  );
});
