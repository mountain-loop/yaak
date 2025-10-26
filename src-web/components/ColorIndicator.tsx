import classNames from 'classnames';
import type { CSSProperties } from 'react';

interface Props {
  color: string | null;
  onClick?: () => void;
}

export function ColorIndicator({ color, onClick }: Props) {
  const style: CSSProperties = { backgroundColor: color ?? undefined };
  const className =
    'inline-block w-[0.75em] h-[0.75em] rounded-full mr-1.5 border border-transparent';

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={style}
        className={classNames(className, 'hover:border-text')}
      />
    );
  } else {
    return <span style={style} className={className} />;
  }
}
