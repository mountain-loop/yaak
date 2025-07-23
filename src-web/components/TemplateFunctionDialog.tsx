import type { TemplateFunction } from '@yaakapp-internal/plugins';
import type { FnArg, Tokens } from '@yaakapp-internal/templates';
import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import {
  templateTokensToString,
  useTemplateTokensToString,
} from '../hooks/useTemplateTokensToString';
import { useToggle } from '../hooks/useToggle';
import { convertTemplateToInsecure } from '../lib/encryption';
import { setupOrConfigureEncryption } from '../lib/setupOrConfigureEncryption';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { LoadingIcon } from './core/LoadingIcon';
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
        const template = await templateTokensToString(initialTokens);
        initial.value = await convertTemplateToInsecure(template);
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
    <VStack
      as="form"
      className="pb-3"
      space={4}
      onSubmit={(e) => {
        e.preventDefault();
        handleDone();
      }}
    >
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
          autocompleteVariables
          autocompleteFunctions
          inputs={templateFunction.args}
          data={argValues}
          onChange={setArgValues}
          stateKey={`template_function.${templateFunction.name}`}
        />
      )}
      {enablePreview && (
        <VStack className="w-full" space={1}>
          <HStack space={0.5}>
            <HStack className="text-sm text-text-subtle" space={1.5}>
              Rendered Preview
              {rendered.isPending && <LoadingIcon size="xs" />}
            </HStack>
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
          <InlineCode
            className={classNames(
              'whitespace-pre-wrap select-text cursor-text max-h-[10rem] overflow-y-auto hide-scrollbars',
              tooLarge && 'italic text-danger',
            )}
          >
            {rendered.error || tagText.error ? (
              <em className="text-danger">
                {`${rendered.error || tagText.error}`.replace(/^Render Error: /, '')}
              </em>
            ) : dataContainsSecrets && !showSecretsInPreview ? (
              <span className="italic text-text-subtle">------ sensitive values hidden ------</span>
            ) : tooLarge ? (
              'too large to preview'
            ) : (
              rendered.data || <>&nbsp;</>
            )}
          </InlineCode>
        </VStack>
      )}
      <div className="flex justify-stretch w-full flex-grow gap-2 [&>*]:flex-1">
        {templateFunction.name === 'secure' && (
          <Button variant="border" color="secondary" onClick={setupOrConfigureEncryption}>
            Reveal Encryption Key
          </Button>
        )}
        <Button type="submit" color="primary">
          Save
        </Button>
      </div>
    </VStack>
  );
}
