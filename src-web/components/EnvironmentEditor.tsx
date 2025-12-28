import type { Environment } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { useCallback, useMemo } from 'react';
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
import { DismissibleBanner } from './core/DismissibleBanner';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import { Heading } from './core/Heading';
import type { PairEditorHandle, PairWithId } from './core/PairEditor';
import { ensurePairId } from './core/PairEditor.util';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { PillButton } from './core/PillButton';
import { EnvironmentColorIndicator } from './EnvironmentColorIndicator';
import { EnvironmentSharableTooltip } from './EnvironmentSharableTooltip';

interface Props {
  environment: Environment;
  hideName?: boolean;
  className?: string;
  setRef?: (n: PairEditorHandle | null) => void;
}

export function EnvironmentEditor({ environment, hideName, className, setRef }: Props) {
  const workspaceId = environment.workspaceId;
  const isEncryptionEnabled = useIsEncryptionEnabled();
  const valueVisibility = useKeyValue<boolean>({
    namespace: 'global',
    key: ['environmentValueVisibility', workspaceId],
    fallback: false,
  });
  const { allEnvironments } = useEnvironmentsBreakdown();
  const handleChange = useCallback(
    (variables: PairWithId[]) => patchModel(environment, { variables }),
    [environment],
  );
  const [forceUpdateKey, regenerateForceUpdateKey] = useRandomKey();

  // Gather a list of env names from other environments to help the user get them aligned
  const nameAutocomplete = useMemo<GenericCompletionConfig>(() => {
    const options: GenericCompletionOption[] = [];
    if (isBaseEnvironment(environment)) {
      return { options };
    }

    const allVariables = allEnvironments.flatMap((e) => e?.variables);
    const allVariableNames = new Set(allVariables.map((v) => v?.name));
    for (const name of allVariableNames) {
      const containingEnvs = allEnvironments.filter((e) =>
        e.variables.some((v) => v.name === name),
      );
      const isAlreadyInActive = containingEnvs.find((e) => e.id === environment.id);
      if (isAlreadyInActive) {
        continue;
      }
      options.push({
        label: name,
        type: 'constant',
        detail: containingEnvs.map((e) => e.name).join(', '),
      });
    }
    return { options };
  }, [environment, allEnvironments]);

  const validateName = useCallback((name: string) => {
    // Empty just means the variable doesn't have a name yet and is unusable
    if (name === '') return true;
    return name.match(/^[a-z_][a-z0-9_.-]*$/i) != null;
  }, []);

  const valueType = !isEncryptionEnabled && valueVisibility.value ? 'text' : 'password';
  const allVariableAreEncrypted = useMemo(
    () =>
      environment.variables.every((v) => v.value === '' || analyzeTemplate(v.value) !== 'insecure'),
    [environment.variables],
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
    <div
      className={classNames(
        className,
        'h-full grid grid-rows-[auto_minmax(0,1fr)] gap-2 pr-3 pb-3',
      )}
    >
      <div className="flex flex-col gap-4">
        <Heading className="w-full flex items-center gap-0.5">
          <EnvironmentColorIndicator
            className="mr-2"
            clickToEdit
            environment={environment ?? null}
          />
          {!hideName && <div className="mr-2">{environment?.name}</div>}
          {isEncryptionEnabled ? (
            !allVariableAreEncrypted ? (
              <PillButton color="notice" onClick={() => encryptEnvironment(environment)}>
                Encrypt All Variables
              </PillButton>
            ) : (
              <PillButton color="secondary" onClick={setupOrConfigureEncryption}>
                Encryption Settings
              </PillButton>
            )
          ) : (
            <PillButton color="secondary" onClick={() => valueVisibility.set((v) => !v)}>
              {valueVisibility.value ? 'Hide Values' : 'Show Values'}
            </PillButton>
          )}
          <PillButton
            color="secondary"
            rightSlot={<EnvironmentSharableTooltip />}
            onClick={async () => {
              await patchModel(environment, { public: !environment.public });
            }}
          >
            {environment.public ? 'Sharable' : 'Private'}
          </PillButton>
        </Heading>
        {environment.public && (!isEncryptionEnabled || !allVariableAreEncrypted) && (
          <DismissibleBanner
            id={`warn-unencrypted-${environment.id}`}
            color="notice"
            className="mr-3"
            actions={[
              {
                label: 'Encrypt Variables',
                onClick: () => encryptEnvironment(environment),
                color: 'success',
              },
            ]}
          >
            This sharable environment contains plain-text secrets
          </DismissibleBanner>
        )}
      </div>
      <PairOrBulkEditor
        setRef={setRef}
        className="h-full"
        allowMultilineValues
        preferenceName="environment"
        nameAutocomplete={nameAutocomplete}
        namePlaceholder="VAR_NAME"
        nameValidate={validateName}
        valueType={valueType}
        valueAutocompleteVariables="environment"
        valueAutocompleteFunctions
        forceUpdateKey={`${environment.id}::${forceUpdateKey}`}
        pairs={environment.variables}
        onChange={handleChange}
        stateKey={`environment.${environment.id}`}
        forcedEnvironmentId={environment.id}
      />
    </div>
  );
}
