import type { Color } from '@yaakapp-internal/plugins';
import { Button } from './Button';
import { HStack } from './Stacks';

export interface ConfirmProps {
  onHide: () => void;
  onResult: (result: boolean) => void;
  confirmText?: string;
  color?: Color;
}

export function Confirm({ onHide, onResult, confirmText, color = 'primary' }: ConfirmProps) {
  const handleHide = () => {
    onResult(false);
    onHide();
  };

  const handleSuccess = () => {
    onResult(true);
    onHide();
  };

  return (
    <HStack space={2} justifyContent="start" className="mt-2 mb-4 flex-row-reverse">
      <Button color={color} onClick={handleSuccess}>
        {confirmText ?? 'Confirm'}
      </Button>
      <Button onClick={handleHide} variant="border">
        Cancel
      </Button>
    </HStack>
  );
}
