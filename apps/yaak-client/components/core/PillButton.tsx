import classNames from 'classnames';
import type { ButtonProps } from './Button';
import { Button } from './Button';

export function PillButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      size="2xs"
      variant="border"
      className={classNames(className, '!rounded-full mx-1 !px-3')}
      {...props}
    />
  );
}
