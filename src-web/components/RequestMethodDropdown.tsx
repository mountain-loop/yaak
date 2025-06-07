import type { HttpRequest } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { showPrompt } from '../lib/prompt';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';
import { Icon } from './core/Icon';
import type { RadioDropdownItem } from './core/RadioDropdown';
import { RadioDropdown } from './core/RadioDropdown';

type Props = {
  request: HttpRequest;
  className?: string;
};

const radioItems: RadioDropdownItem<string>[] = [
  'GET',
  'PUT',
  'POST',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'QUERY',
  'HEAD',
].map((m) => ({
  value: m,
  label: m,
}));

export const RequestMethodDropdown = memo(function RequestMethodDropdown({
  request,
  className,
}: Props) {
  const handleChange = useCallback(
    async (method: string) => {
      await patchModel(request, { method });
    },
    [request],
  );

  const itemsAfter = useMemo<DropdownItem[]>(
    () => [
      {
        key: 'custom',
        label: 'CUSTOM',
        leftSlot: <Icon icon="sparkles" />,
        onSelect: async () => {
          const newMethod = await showPrompt({
            id: 'custom-method',
            label: 'Http Method',
            defaultValue: '',
            title: 'Custom Method',
            confirmText: 'Save',
            description: 'Enter a custom method name',
            placeholder: 'CUSTOM',
          });
          if (newMethod == null) return;
          await handleChange(newMethod);
        },
      },
    ],
    [handleChange],
  );

  return (
    <RadioDropdown
      value={request.method}
      items={radioItems}
      itemsAfter={itemsAfter}
      onChange={handleChange}
    >
      <Button size="xs" className={classNames(className, 'text-text-subtle hover:text')}>
        <HttpMethodTag request={request} />
      </Button>
    </RadioDropdown>
  );
});
