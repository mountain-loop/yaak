import classNames from 'classnames';
import type { CSSProperties } from 'react';

interface Props {
  color: string | null;
  onClick?: () => void;
  className?: string;
}

export function ColorIndicator({ color, onClick, className }: Props) {
  const style: CSSProperties = { backgroundColor: color ?? undefined };
  const finalClassName = classNames(
    className,
    'inline-block w-[0.75em] h-[0.75em] rounded-full mr-1.5 border border-transparent flex-shrink-0',
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={style}
        className={classNames(finalClassName, 'hover:border-text')}
      />
    );
  } else {
    return <span style={style} className={finalClassName} />;
  }
}
