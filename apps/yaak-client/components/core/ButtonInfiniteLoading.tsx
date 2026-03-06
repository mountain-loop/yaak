import { useState } from 'react';
import type { ButtonProps } from './Button';
import { Button } from './Button';

export function ButtonInfiniteLoading({
  onClick,
  isLoading,
  loadingChildren,
  children,
  ...props
}: ButtonProps & { loadingChildren?: string }) {
  const [localIsLoading, setLocalIsLoading] = useState<boolean>(false);
  return (
    <Button
      isLoading={localIsLoading || isLoading}
      onClick={(e) => {
        setLocalIsLoading(true);
        onClick?.(e);
      }}
      {...props}
    >
      {localIsLoading ? (loadingChildren ?? children) : children}
    </Button>
  );
}
