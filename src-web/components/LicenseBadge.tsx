import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';

export function LicenseBadge() {

  return (
    <LicenseBadgeButton
      color={"success"}
    >
      Forked
    </LicenseBadgeButton>
  );
}

function LicenseBadgeButton({ ...props }: ButtonProps) {
  return <Button size="2xs" variant="border" className="!rounded-full mx-1" {...props} />;
}
