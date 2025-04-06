import type { ButtonProps } from './Button';
import { Button } from './Button';

export function BadgeButton(props: ButtonProps) {
  return <Button size="2xs" variant="border" className="!rounded-full mx-1" {...props} />;
}
