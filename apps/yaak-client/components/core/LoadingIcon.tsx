import classNames from 'classnames';

interface Props {
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function LoadingIcon({ size = 'md', className }: Props) {
  const classes = classNames(
    className,
    'text-inherit flex-shrink-0',
    size === 'xl' && 'h-6 w-6',
    size === 'lg' && 'h-5 w-5',
    size === 'md' && 'h-4 w-4',
    size === 'sm' && 'h-3.5 w-3.5',
    size === 'xs' && 'h-3 w-3',
    size === '2xs' && 'h-2.5 w-2.5',
    'animate-spin',
  );

  return (
    <div
      className={classNames(
        classes,
        'border-[currentColor] border-b-transparent rounded-full',
        size === 'xl' && 'border-[0.2rem]',
        size === 'lg' && 'border-[0.16rem]',
        size === 'md' && 'border-[0.13rem]',
        size === 'sm' && 'border-[0.1rem]',
        size === 'xs' && 'border-[0.08rem]',
        size === '2xs' && 'border-[0.06rem]',
      )}
    />
  );
}
