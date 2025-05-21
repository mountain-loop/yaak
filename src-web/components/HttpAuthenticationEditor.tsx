import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { Checkbox } from './core/Checkbox';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';
import { DynamicForm } from './DynamicForm';
import { EmptyStateText } from './EmptyStateText';

interface Props {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;
}

export function HttpAuthenticationEditor({ model }: Props) {
  const { authentication, authenticationType } =
    'defaultAuthentication' in model ? model.defaultAuthentication : model;

  const authConfig = useHttpAuthenticationConfig(authenticationType, authentication, model.id);

  const handleChange = useCallback(
    async (authentication: Record<string, boolean>) => {
      if ('defaultAuthentication' in model) {
        await patchModel(model, { defaultAuthentication: { authenticationType, authentication } });
      } else {
        await patchModel(model, { authentication });
      }
    },
    [authenticationType, model],
  );

  if (authConfig.data == null) {
    return <EmptyStateText>No Authentication {authenticationType}</EmptyStateText>;
  }

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <HStack space={2} className="mb-2" alignItems="center">
        <Checkbox
          className="w-full"
          checked={!authentication.disabled}
          onChange={(disabled) => handleChange({ ...authentication, disabled: !disabled })}
          title="Enabled"
        />
        {authConfig.data.actions && authConfig.data.actions.length > 0 && (
          <Dropdown
            items={authConfig.data.actions.map(
              (a): DropdownItem => ({
                label: a.label,
                leftSlot: a.icon ? <Icon icon={a.icon} /> : null,
                onSelect: () => a.call(model),
              }),
            )}
          >
            <IconButton title="Authentication Actions" icon="settings" size="xs" />
          </Dropdown>
        )}
      </HStack>
      <DynamicForm
        disabled={authentication.disabled}
        autocompleteVariables
        autocompleteFunctions
        stateKey={`auth.${model.id}.${authenticationType}`}
        inputs={authConfig.data.args}
        data={authentication}
        onChange={handleChange}
      />
    </div>
  );
}
