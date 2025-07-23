import React from 'react';
import type { IconProps } from './Icon';
import { Icon } from './Icon';
import type { TooltipProps } from './Tooltip';
import { Tooltip } from './Tooltip';

type Props = Omit<TooltipProps, 'children'> & {
  icon?: IconProps['icon'];
  iconSize?: IconProps['size'];
  iconColor?: IconProps['color'];
  className?: string;
  tabIndex?: number;
};

export function IconTooltip({
  content,
  icon = 'info',
  iconColor,
  iconSize,
  ...tooltipProps
}: Props) {
  return (
    <Tooltip content={content} {...tooltipProps}>
      <Icon
        className="opacity-60 hover:opacity-100"
        icon={icon}
        size={iconSize}
        color={iconColor}
      />
    </Tooltip>
  );
}
