import type { Environment } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import React, { useCallback, useMemo } from 'react';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { useIsEncryptionEnabled } from '../hooks/useIsEncryptionEnabled';
import { useKeyValue } from '../hooks/useKeyValue';
import { useRandomKey } from '../hooks/useRandomKey';
import { analyzeTemplate, convertTemplateToSecure } from '../lib/encryption';
import { isBaseEnvironment } from '../lib/model_util';
import {
  setupOrConfigureEncryption,
  withEncryptionEnabled,
} from '../lib/setupOrConfigureEncryption';
import { BadgeButton } from './core/BadgeButton';
import { DismissibleBanner } from './core/DismissibleBanner';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import { Heading } from './core/Heading';
import type { PairWithId } from './core/PairEditor';
import { ensurePairId } from './core/PairEditor';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { VStack } from './core/Stacks';
import { EnvironmentColorIndicator } from './EnvironmentColorIndicator';
import { EnvironmentSharableTooltip } from './EnvironmentSharableTooltip';

export function EnvironmentEditor({
  environment: selectedEnvironment,
  hideName,
  className,
}: {
  environment: Environment;
  hideName?: boolean;
  className?: string;
}) {
  const workspaceId = selectedEnvironment.workspaceId;
  const isEncryptionEnabled = useIsEncryptionEnabled();
  const valueVisibility = useKeyValue<boolean>({
    namespace: 'global',
    key: ['environmentValueVisibility', workspaceId],
    fallback: false,
  });
  const { allEnvironments } = useEnvironmentsBreakdown();
  const handleChange = useCallback(
    (variables: PairWithId[]) => patchModel(selectedEnvironment, { variables }),
    [selectedEnvironment],
  );
  const [forceUpdateKey, regenerateForceUpdateKey] = useRandomKey();

  // Gather a list of env names from other environments to help the user get them aligned
  const nameAutocomplete = useMemo<GenericCompletionConfig>(() => {
    const options: GenericCompletionOption[] = [];
    if (isBaseEnvironment(selectedEnvironment)) {
      return { options };
    }

    const allVariables = allEnvironments.flatMap((e) => e?.variables);
    const allVariableNames = new Set(allVariables.map((v) => v?.name));
    for (const name of allVariableNames) {
      const containingEnvs = allEnvironments.filter((e) =>
        e.variables.some((v) => v.name === name),
      );
      const isAlreadyInActive = containingEnvs.find((e) => e.id === selectedEnvironment.id);
      if (isAlreadyInActive) continue;
      options.push({
        label: name,
        type: 'constant',
        detail: containingEnvs.map((e) => e.name).join(', '),
      });
    }
    return { options };
  }, [selectedEnvironment, allEnvironments]);

  const validateName = useCallback((name: string) => {
    // Empty just means the variable doesn't have a name yet and is unusable
    if (name === '') return true;
    return name.match(/^[a-z_][a-z0-9_-]*$/i) != null;
  }, []);

  const valueType = !isEncryptionEnabled && valueVisibility.value ? 'text' : 'password';
  const allVariableAreEncrypted = useMemo(
    () =>
      selectedEnvironment.variables.every(
        (v) => v.value === '' || analyzeTemplate(v.value) !== 'insecure',
      ),
    [selectedEnvironment.variables],
  );

  const encryptEnvironment = (environment: Environment) => {
    withEncryptionEnabled(async () => {
      const encryptedVariables: PairWithId[] = [];
      for (const variable of environment.variables) {
        const value = variable.value ? await convertTemplateToSecure(variable.value) : '';
        encryptedVariables.push(ensurePairId({ ...variable, value }));
      }
      await handleChange(encryptedVariables);
      regenerateForceUpdateKey();
    });
  };

  return (
    <VStack space={4} className={className}>
      <Heading className="w-full flex items-center gap-0.5">
        <EnvironmentColorIndicator clickToEdit environment={selectedEnvironment ?? null} />
        {!hideName && <div className="mr-2">{selectedEnvironment?.name}</div>}
        {isEncryptionEnabled ? (
          !allVariableAreEncrypted ? (
            <BadgeButton color="notice" onClick={() => encryptEnvironment(selectedEnvironment)}>
              Encrypt All Variables
            </BadgeButton>
          ) : (
            <BadgeButton color="secondary" onClick={setupOrConfigureEncryption}>
              Encryption Settings
            </BadgeButton>
          )
        ) : (
          <BadgeButton color="secondary" onClick={() => valueVisibility.set((v) => !v)}>
            {valueVisibility.value ? 'Hide Values' : 'Show Values'}
          </BadgeButton>
        )}
        <BadgeButton
          color="secondary"
          rightSlot={<EnvironmentSharableTooltip />}
          onClick={async () => {
            await patchModel(selectedEnvironment, { public: !selectedEnvironment.public });
          }}
        >
          {selectedEnvironment.public ? 'Sharable' : 'Private'}
        </BadgeButton>
      </Heading>
      {selectedEnvironment.public && (!isEncryptionEnabled || !allVariableAreEncrypted) && (
        <DismissibleBanner
          id={`warn-unencrypted-${selectedEnvironment.id}`}
          color="notice"
          className="mr-3"
          actions={[
            {
              label: 'Encrypt Variables',
              onClick: () => encryptEnvironment(selectedEnvironment),
              color: 'primary',
            },
          ]}
        >
          This sharable environment contains plain-text secrets
        </DismissibleBanner>
      )}
      <div className="h-full pr-2 pb-2 grid grid-rows-[minmax(0,1fr)] overflow-auto">
        <PairOrBulkEditor
          allowMultilineValues
          preferenceName="environment"
          nameAutocomplete={nameAutocomplete}
          namePlaceholder="VAR_NAME"
          nameValidate={validateName}
          valueType={valueType}
          valueAutocompleteVariables
          valueAutocompleteFunctions
          forceUpdateKey={`${selectedEnvironment.id}::${forceUpdateKey}`}
          pairs={selectedEnvironment.variables}
          onChange={handleChange}
          stateKey={`environment.${selectedEnvironment.id}`}
          forcedEnvironmentId={
            // Editing the base environment should resolve variables using the active environment.
            // Editing a sub environment should resolve variables as if it's the active environment
            isBaseEnvironment(selectedEnvironment) ? undefined : selectedEnvironment.id
          }
        />
      </div>
    </VStack>
  );
}
