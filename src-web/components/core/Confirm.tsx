import type { ButtonProps } from './Button';
import { Button } from './Button';
import { HStack } from './Stacks';

export interface ConfirmProps {
  onHide: () => void;
  onResult: (result: boolean) => void;
  variant?: 'delete' | 'confirm';
  confirmText?: string;
}

const colors: Record<NonNullable<ConfirmProps['variant']>, ButtonProps['color']> = {
  delete: 'danger',
  confirm: 'primary',
};

const confirmButtonTexts: Record<NonNullable<ConfirmProps['variant']>, string> = {
  delete: 'Delete',
  confirm: 'Confirm',
};

export function Confirm({ onHide, onResult, confirmText, variant = 'confirm' }: ConfirmProps) {
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
      <Button color={colors[variant]} onClick={handleSuccess}>
        {confirmText ?? confirmButtonTexts[variant]}
      </Button>
      <Button onClick={handleHide} variant="border">
        Cancel
      </Button>
    </HStack>
  );
}
