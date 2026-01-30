import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { useCallback } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { useInheritedAuthentication } from '../hooks/useInheritedAuthentication';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import { resolvedModelName } from '../lib/resolvedModelName';
import { Dropdown, type DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { Input, type InputProps } from './core/Input';
import { Link } from './core/Link';
import { SegmentedControl } from './core/SegmentedControl';
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
    async (authentication: Record<string, unknown>) => await patchModel(model, { authentication }),
    [model],
  );

  if (model.authenticationType === 'none') {
    return <EmptyStateText>No authentication</EmptyStateText>;
  }

  if (model.authenticationType != null && authConfig.data == null) {
    return (
      <EmptyStateText>
        <p>
          Auth plugin not found for <InlineCode>{model.authenticationType}</InlineCode>
        </p>
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
          <Link href="https://yaak.app/docs/using-yaak/request-inheritance">Documentation</Link>
        </EmptyStateText>
      );
    }
    return <EmptyStateText>No authentication</EmptyStateText>;
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
            type="submit"
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
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-y-3">
      <div>
        <HStack space={2} alignItems="start">
          <SegmentedControl
            label="Enabled"
            hideLabel
            name="enabled"
            value={
              model.authentication.disabled === false || model.authentication.disabled == null
                ? '__TRUE__'
                : model.authentication.disabled === true
                  ? '__FALSE__'
                  : '__DYNAMIC__'
            }
            options={[
              { label: 'Enabled', value: '__TRUE__' },
              { label: 'Disabled', value: '__FALSE__' },
              { label: 'Enabled when...', value: '__DYNAMIC__' },
            ]}
            onChange={async (enabled) => {
              let disabled: boolean | string;
              if (enabled === '__TRUE__') {
                disabled = false;
              } else if (enabled === '__FALSE__') {
                disabled = true;
              } else {
                disabled = '';
              }
              await handleChange({ ...model.authentication, disabled });
            }}
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
              <IconButton
                title="Authentication Actions"
                icon="settings"
                size="xs"
                className="!text-secondary"
              />
            </Dropdown>
          )}
        </HStack>
        {typeof model.authentication.disabled === 'string' && (
          <div className="mt-3">
            <AuthenticationDisabledInput
              className="w-full"
              stateKey={`auth.${model.id}.dynamic`}
              value={model.authentication.disabled}
              onChange={(v) => handleChange({ ...model.authentication, disabled: v })}
            />
          </div>
        )}
      </div>
      <DynamicForm
        disabled={model.authentication.disabled === true}
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

function AuthenticationDisabledInput({
  value,
  onChange,
  stateKey,
  className,
}: {
  value: string;
  onChange: InputProps['onChange'];
  stateKey: string;
  className?: string;
}) {
  const rendered = useRenderTemplate({
    template: value,
    enabled: true,
    purpose: 'preview',
    refreshKey: value,
  });

  return (
    <Input
      size="sm"
      className={className}
      label="Dynamic Disabled"
      hideLabel
      defaultValue={value}
      placeholder="Enabled when this renders a non-empty value"
      rightSlot={
        <div className="px-1 flex items-center">
          <div className="rounded-full bg-surface-highlight text-xs px-1.5 py-0.5 text-text-subtle whitespace-nowrap">
            {rendered.isPending ? 'loading' : rendered.data ? 'enabled' : 'disabled'}
          </div>
        </div>
      }
      autocompleteFunctions
      autocompleteVariables
      onChange={onChange}
      stateKey={stateKey}
    />
  );
}
