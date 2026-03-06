import classNames from 'classnames';
import type { ReactNode } from 'react';
import './Prose.css';

interface Props {
  children: ReactNode;
  className?: string;
}

export function Prose({ className, ...props }: Props) {
  return <div className={classNames('prose', className)} {...props} />;
}
