import classNames from 'classnames';
import React from 'react';
import type { IconProps } from './Icon';
import { Icon } from './Icon';
import type { TooltipProps } from './Tooltip';
import { Tooltip } from './Tooltip';

type Props = Omit<TooltipProps, 'children'> & {
  icon?: IconProps['icon'];
  size?: IconProps['size'];
  className?: string;
};

export function IconTooltip({ content, icon = 'info', className, ...iconProps }: Props) {
  return (
    <Tooltip content={content}>
      <Icon
        className={classNames(className, 'opacity-60 hover:opacity-100')}
        icon={icon}
        {...iconProps}
      />
    </Tooltip>
  );
}
