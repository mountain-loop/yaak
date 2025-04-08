import type { TemplateFunction } from '@yaakapp-internal/plugins';
import type { FnArg, Tokens } from '@yaakapp-internal/templates';
import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import { activeEnvironmentIdAtom } from '../hooks/useActiveEnvironment';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { renderTemplate, useRenderTemplate } from '../hooks/useRenderTemplate';
import {
  templateTokensToString,
  useTemplateTokensToString,
} from '../hooks/useTemplateTokensToString';
import { useToggle } from '../hooks/useToggle';
import { jotaiStore } from '../lib/jotai';
import { showSetupWorkspaceEncryptionDialog } from '../lib/showSetupWorkspaceEncryptionDialog';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { DYNAMIC_FORM_NULL_ARG, DynamicForm } from './DynamicForm';

interface Props {
  templateFunction: TemplateFunction;
  initialTokens: Tokens;
  hide: () => void;
  onChange: (insert: string) => void;
}

export function TemplateFunctionDialog({ initialTokens, templateFunction, ...props }: Props) {
  const [initialArgValues, setInitialArgValues] = useState<Record<string, string | boolean> | null>(
    null,
  );
  useEffect(() => {
    if (initialArgValues != null) {
      return;
    }

    (async function () {
      const initial: Record<string, string> = {};
      const initialArgs =
        initialTokens.tokens[0]?.type === 'tag' && initialTokens.tokens[0]?.val.type === 'fn'
          ? initialTokens.tokens[0]?.val.args
          : [];
      for (const arg of templateFunction.args) {
        if (!('name' in arg)) {
          // Skip visual-only args
          continue;
        }
        const initialArg = initialArgs.find((a) => a.name === arg.name);
        const initialArgValue =
          initialArg?.value.type === 'str'
            ? initialArg?.value.text
            : // TODO: Implement variable-based args
              undefined;
        initial[arg.name] = initialArgValue ?? arg.defaultValue ?? DYNAMIC_FORM_NULL_ARG;
      }

      // HACK: Replace the secure() function's encrypted `value` arg with the decrypted version so
      //  we can display it in the editor input.
      if (templateFunction.name === 'secure') {
        const workspaceId = jotaiStore.get(activeWorkspaceIdAtom) ?? 'n/a';
        const environmentId = jotaiStore.get(activeEnvironmentIdAtom) ?? null;
        // Kinda hacky, but render the tag to get the decrypted value, and replace the arg with that
        const newValue = await renderTemplate({
          template: await templateTokensToString(initialTokens),
          workspaceId,
          environmentId,
        });
        initial.value = newValue;
      }

      setInitialArgValues(initial);
    })().catch(console.error);
  }, [
    initialArgValues,
    initialTokens,
    initialTokens.tokens,
    templateFunction.args,
    templateFunction.name,
  ]);

  if (initialArgValues == null) return null;

  return (
    <InitializedTemplateFunctionDialog
      {...props}
      templateFunction={templateFunction}
      initialArgValues={initialArgValues}
    />
  );
}

function InitializedTemplateFunctionDialog({
  templateFunction,
  hide,
  initialArgValues,
  onChange,
}: Omit<Props, 'initialTokens'> & {
  initialArgValues: Record<string, string | boolean>;
}) {
  const enablePreview = templateFunction.name !== 'secure';
  const enableDynamicFormVariables = templateFunction.name !== 'secure';

  const [showSecretsInPreview, toggleShowSecretsInPreview] = useToggle(false);
  const [argValues, setArgValues] = useState<Record<string, string | boolean>>(initialArgValues);

  const tokens: Tokens = useMemo(() => {
    const argTokens: FnArg[] = Object.keys(argValues).map((name) => ({
      name,
      value:
        argValues[name] === DYNAMIC_FORM_NULL_ARG
          ? { type: 'null' }
          : typeof argValues[name] === 'boolean'
            ? { type: 'bool', value: argValues[name] === true }
            : { type: 'str', text: String(argValues[name] ?? '') },
    }));

    return {
      tokens: [
        {
          type: 'tag',
          val: {
            type: 'fn',
            name: templateFunction.name,
            args: argTokens,
          },
        },
      ],
    };
  }, [argValues, templateFunction.name]);

  const tagText = useTemplateTokensToString(tokens);

  const handleDone = () => {
    if (tagText.data) {
      onChange(tagText.data);
    }
    hide();
  };

  const debouncedTagText = useDebouncedValue(tagText.data ?? '', 400);
  const rendered = useRenderTemplate(debouncedTagText);
  const tooLarge = rendered.data ? rendered.data.length > 10000 : false;
  const dataContainsSecrets = useMemo(() => {
    for (const [name, value] of Object.entries(argValues)) {
      const arg = templateFunction.args.find((a) => 'name' in a && a.name === name);
      const isTextPassword = arg?.type === 'text' && arg.password;
      if (isTextPassword && typeof value === 'string' && value && rendered.data?.includes(value)) {
        return true;
      }
    }
    return false;
    // Only update this on rendered data change to keep secrets hidden on input change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.data]);

  return (
    <VStack className="pb-3" space={4}>
      {templateFunction.name === 'secure' ? (
        <PlainInput
          required
          label="Value"
          name="value"
          type="password"
          placeholder="••••••••••••"
          defaultValue={String(argValues['value'] ?? '')}
          onChange={(value) => setArgValues({ ...argValues, value })}
        />
      ) : (
        <DynamicForm
          autocompleteVariables={enableDynamicFormVariables}
          autocompleteFunctions={enableDynamicFormVariables}
          inputs={templateFunction.args}
          data={argValues}
          onChange={setArgValues}
          stateKey={`template_function.${templateFunction.name}`}
        />
      )}
      {enablePreview && (
        <VStack className="w-full" space={1}>
          <HStack space={0.5}>
            <div className="text-sm text-text-subtle">Rendered Preview</div>
            <IconButton
              size="xs"
              iconSize="sm"
              icon={showSecretsInPreview ? 'lock' : 'lock_open'}
              title={showSecretsInPreview ? 'Show preview' : 'Hide preview'}
              onClick={toggleShowSecretsInPreview}
              className={classNames(
                'ml-auto text-text-subtlest',
                !dataContainsSecrets && 'invisible',
              )}
            />
          </HStack>
          {rendered.error || tagText.error ? (
            <Banner color="danger">{`${rendered.error || tagText.error}`}</Banner>
          ) : (
            <InlineCode
              className={classNames(
                'whitespace-pre select-text cursor-text max-h-[10rem] overflow-y-auto hide-scrollbars',
                tooLarge && 'italic text-danger',
              )}
            >
              {dataContainsSecrets && !showSecretsInPreview ? (
                <span className="italic text-text-subtle">
                  ------ sensitive values hidden ------
                </span>
              ) : tooLarge ? (
                'too large to preview'
              ) : (
                rendered.data || <>&nbsp;</>
              )}
            </InlineCode>
          )}
        </VStack>
      )}
      <div className="flex justify-stretch w-full flex-grow gap-2 [&>*]:flex-1">
        {templateFunction.name === 'secure' && (
          <Button variant="border" color="secondary" onClick={showSetupWorkspaceEncryptionDialog}>
            Reveal Encryption Key
          </Button>
        )}
        <Button color="primary" onClick={handleDone}>
          Save
        </Button>
      </div>
    </VStack>
  );
}
