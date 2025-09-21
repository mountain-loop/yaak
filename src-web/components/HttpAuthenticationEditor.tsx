import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { useInheritedAuthentication } from '../hooks/useInheritedAuthentication';
import { resolvedModelName } from '../lib/resolvedModelName';
import { Checkbox } from './core/Checkbox';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { Link } from './core/Link';
import { HStack } from './core/Stacks';
import { DynamicForm } from './DynamicForm';
import { EmptyStateText } from './EmptyStateText';

interface Props {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;
}

export function HttpAuthenticationEditor({ model }: Props) {
  const inheritedAuth = useInheritedAuthentication(model);
  const authConfig = useHttpAuthenticationConfig(
    model.authenticationType,
    model.authentication,
    model,
  );

  const handleChange = useCallback(
    async (authentication: Record<string, boolean>) => await patchModel(model, { authentication }),
    [model],
  );

  if (model.authenticationType === 'none') {
    return <EmptyStateText>No authentication</EmptyStateText>;
  }

  if (model.authenticationType != null && authConfig.data == null) {
    return (
      <EmptyStateText>
        Unknown authentication <InlineCode>{authConfig.data}</InlineCode>
      </EmptyStateText>
    );
  }

  if (inheritedAuth == null) {
    if (model.model === 'workspace' || model.model === 'folder') {
      return (
        <EmptyStateText className="flex-col gap-1">
          <p>
            Apply auth to all requests in <strong>{resolvedModelName(model)}</strong>
          </p>
          <Link href="https://feedback.yaak.app/help/articles/2112119-request-inheritance">
            Documentation
          </Link>
        </EmptyStateText>
      );
    } else {
      return <EmptyStateText>Authentication not configured</EmptyStateText>;
    }
  }

  if (inheritedAuth.authenticationType === 'none') {
    return <EmptyStateText>No authentication</EmptyStateText>;
  }

  const wasAuthInherited = inheritedAuth?.id !== model.id;
  if (wasAuthInherited) {
    const name = resolvedModelName(inheritedAuth);
    const cta = inheritedAuth.model === 'workspace' ? 'Workspace' : name;
    return (
      <EmptyStateText>
        <p>
          Inherited from{' '}
          <button
            className="underline hover:text-text"
            onClick={() => {
              if (inheritedAuth.model === 'folder') openFolderSettings(inheritedAuth.id, 'auth');
              else openWorkspaceSettings('auth');
            }}
          >
            {cta}
          </button>
        </p>
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
        {authConfig.data?.actions && authConfig.data.actions.length > 0 && (
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
        inputs={authConfig.data?.args ?? []}
        data={model.authentication}
        onChange={handleChange}
      />
    </div>
  );
}
