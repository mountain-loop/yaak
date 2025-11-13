import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import type { FormInput, TemplateFunction } from '@yaakapp-internal/plugins';
import type { FnArg, Tokens } from '@yaakapp-internal/templates';
import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { RenderTemplateBehavior } from '../hooks/useRenderTemplate';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import { useTemplateFunctionConfig } from '../hooks/useTemplateFunctionConfig';
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
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;
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
      const initial = collectArgumentValues(initialTokens, templateFunction);

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
    templateFunction,
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
  templateFunction: { name, previewType: ogPreviewType },
  initialArgValues,
  hide,
  onChange,
  model,
}: Omit<Props, 'initialTokens'> & {
  initialArgValues: Record<string, string | boolean>;
}) {
  const previewType = ogPreviewType == null ? 'live' : ogPreviewType;
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
            name,
            args: argTokens,
          },
        },
      ],
    };
  }, [argValues, name]);

  const tagText = useTemplateTokensToString(tokens);
  const templateFunction = useTemplateFunctionConfig(name, argValues, model).data;

  const handleDone = () => {
    if (tagText.data) {
      onChange(tagText.data);
    }
    hide();
  };

  const debouncedTagText = useDebouncedValue(tagText.data ?? '', 400);
  const [renderKey, setRenderKey] = useState<string | null>(null);

  const renderBehavior = useMemo<RenderTemplateBehavior>(() => {
    if (previewType === 'live') {
      return { type: 'key_change', key: renderKey + debouncedTagText };
    } else if (previewType === 'click') {
      return { type: 'key_change', key: renderKey };
    }
    return { type: 'never' };
  }, [debouncedTagText, previewType, renderKey]);

  const rendered = useRenderTemplate(debouncedTagText, renderBehavior);

  const tooLarge = rendered.data ? rendered.data.length > 10000 : false;
  const dataContainsSecrets = useMemo(() => {
    for (const [name, value] of Object.entries(argValues)) {
      const arg = templateFunction?.args.find((a) => 'name' in a && a.name === name);
      const isTextPassword = arg?.type === 'text' && arg.password;
      if (isTextPassword && typeof value === 'string' && value && rendered.data?.includes(value)) {
        return true;
      }
    }
    return false;
    // Only update this on rendered data change to keep secrets hidden on input change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.data]);

  if (templateFunction == null) return null;

  return (
    <form
      className="grid grid-rows-[minmax(0,1fr)_auto_auto] h-full max-h-[90vh]"
      onSubmit={(e) => {
        e.preventDefault();
        handleDone();
      }}
    >
      <div className="overflow-y-auto h-full px-6">
        {name === 'secure' ? (
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
      </div>
      <div className="px-6 border-t border-t-border py-3 bg-surface-highlight w-full flex flex-col gap-4">
        {previewType !== 'none' ? (
          <VStack className="w-full">
            <HStack space={0.5}>
              <HStack className="text-sm text-text-subtle" space={1.5}>
                Rendered Preview
                {rendered.isLoading && <LoadingIcon size="xs" />}
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
                'relative',
                'whitespace-pre-wrap !select-text cursor-text max-h-[10rem] overflow-y-auto hide-scrollbars !border-text-subtlest',
                tooLarge && 'italic text-danger',
              )}
            >
              {rendered.error || tagText.error ? (
                <em className="text-danger">
                  {`${rendered.error || tagText.error}`.replace(/^Render Error: /, '')}
                </em>
              ) : dataContainsSecrets && !showSecretsInPreview ? (
                <span className="italic text-text-subtle">
                  ------ sensitive values hidden ------
                </span>
              ) : tooLarge ? (
                'too large to preview'
              ) : (
                rendered.data || <>&nbsp;</>
              )}
              <div className="absolute right-0 top-0 bottom-0 flex items-center">
                <IconButton
                  size="xs"
                  icon="refresh"
                  className="text-text-subtle"
                  title="Refresh preview"
                  spin={rendered.isLoading}
                  onClick={() => {
                    setRenderKey(new Date().toISOString());
                  }}
                />
              </div>
            </InlineCode>
          </VStack>
        ) : (
          <span />
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
      </div>
    </form>
  );
}

/**
 * Process the initial tokens from the template and merge those with the default values pulled from
 * the template function definition.
 */
function collectArgumentValues(initialTokens: Tokens, templateFunction: TemplateFunction) {
  const initial: Record<string, string | boolean> = {};
  const initialArgs =
    initialTokens.tokens[0]?.type === 'tag' && initialTokens.tokens[0]?.val.type === 'fn'
      ? initialTokens.tokens[0]?.val.args
      : [];

  const processArg = (arg: FormInput) => {
    if ('inputs' in arg && arg.inputs) {
      arg.inputs.forEach(processArg);
    }
    if (!('name' in arg)) return;

    const initialArg = initialArgs.find((a) => a.name === arg.name);
    const initialArgValue = initialArg?.value.type === 'str' ? initialArg?.value.text : undefined;
    initial[arg.name] = initialArgValue ?? arg.defaultValue ?? DYNAMIC_FORM_NULL_ARG;
  };

  templateFunction.args.forEach(processArg);

  return initial;
}
