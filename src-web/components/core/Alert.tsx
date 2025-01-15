import type { ReactNode } from 'react';
import { Button } from './Button';
import { HStack, VStack } from './Stacks';

export interface AlertProps {
  onHide: () => void;
  body: ReactNode;
}

export function Alert({ onHide, body }: AlertProps) {
  return (
    <VStack space={3} className="pb-4">
      <div>{body}</div>
      <HStack space={2} justifyContent="end">
        <Button className="focus" color="primary" onClick={onHide}>
          Okay
        </Button>
      </HStack>
    </VStack>
  );
}
