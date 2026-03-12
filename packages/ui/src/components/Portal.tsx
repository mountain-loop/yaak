import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePortal } from '../hooks/usePortal';

interface Props {
  children: ReactNode;
  name: string;
}

export function Portal({ children, name }: Props) {
  const portal = usePortal(name);
  return createPortal(children, portal);
}
