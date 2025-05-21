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
import { IconTooltip } from './core/IconTooltip';
import { InlineCode } from './core/InlineCode';
import { HStack } from './core/Stacks';
import { DynamicForm } from './DynamicForm';
import { EmptyStateText } from './EmptyStateText';

interface Props {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;
}

export function HttpAuthenticationEditor({ model }: Props) {
  const authConfig = useHttpAuthenticationConfig(
    model.authenticationType,
    model.authentication,
    model.id,
  );

  const handleChange = useCallback(
    async (authentication: Record<string, boolean>) => await patchModel(model, { authentication }),
    [model],
  );

  if (model.authenticationType === null) {
    return (
      <EmptyStateText className="flex items-center gap-1">
        Inherited authentication{' '}
        <IconTooltip content="Authentication will be inherited from parent folder or workspace, if defined." />
      </EmptyStateText>
    );
  }

  if (model.authenticationType === 'none') {
    return <EmptyStateText>No authentication</EmptyStateText>;
  }

  if (authConfig.data == null) {
    return (
      <EmptyStateText>
        Unknown authentication <InlineCode>{authConfig.data}</InlineCode>
      </EmptyStateText>
    );
  }

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <HStack space={2} className="mb-2" alignItems="center">
        <Checkbox
          className="w-full"
          checked={!model.authentication.disabled}
          onChange={(disabled) => handleChange({ ...model.authentication, disabled: !disabled })}
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
        disabled={model.authentication.disabled}
        autocompleteVariables
        autocompleteFunctions
        stateKey={`auth.${model.id}.${model.authenticationType}`}
        inputs={authConfig.data.args}
        data={model.authentication}
        onChange={handleChange}
      />
    </div>
  );
}
