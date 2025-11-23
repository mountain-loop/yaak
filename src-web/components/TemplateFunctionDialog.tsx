import type { EditorView } from '@codemirror/view';
import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import type { TemplateFunction } from '@yaakapp-internal/plugins';
import type { FnArg, Tokens } from '@yaakapp-internal/templates';
import { parseTemplate } from '@yaakapp-internal/templates';
import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import { useTemplateFunctionConfig } from '../hooks/useTemplateFunctionConfig';
import {
  templateTokensToString,
  useTemplateTokensToString,
} from '../hooks/useTemplateTokensToString';
import { useToggle } from '../hooks/useToggle';
import { showDialog } from '../lib/dialog';
import { convertTemplateToInsecure } from '../lib/encryption';
import { jotaiStore } from '../lib/jotai';
import { setupOrConfigureEncryption } from '../lib/setupOrConfigureEncryption';
import { DYNAMIC_FORM_NULL_ARG, DynamicForm } from './DynamicForm';
import { Button } from './core/Button';
import { collectArgumentValues } from './core/Editor/twig/util';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { LoadingIcon } from './core/LoadingIcon';
import { PlainInput } from './core/PlainInput';
import { HStack } from './core/Stacks';

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

    (async () => {
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
  const templateFunction = useTemplateFunctionConfig(name, argValues, model);

  const handleDone = () => {
    if (tagText.data) {
      onChange(tagText.data);
    }
    hide();
  };

  const debouncedTagText = useDebouncedValue(tagText.data ?? '', 400);
  const [renderKey, setRenderKey] = useState<string | null>(null);
  const rendered = useRenderTemplate(
    debouncedTagText,
    previewType !== 'none',
    previewType === 'click' ? 'send' : 'preview',
    previewType === 'live' ? renderKey + debouncedTagText : renderKey,
  );

  const tooLarge = rendered.data ? rendered.data.length > 10000 : false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update this on rendered data change to keep secrets hidden on input change
  const dataContainsSecrets = useMemo(() => {
    for (const [name, value] of Object.entries(argValues)) {
      const arg = templateFunction.data?.args.find((a) => 'name' in a && a.name === name);
      const isTextPassword = arg?.type === 'text' && arg.password;
      if (isTextPassword && typeof value === 'string' && value && rendered.data?.includes(value)) {
        return true;
      }
    }
    return false;
  }, [rendered.data]);

  if (templateFunction.data == null || templateFunction.isPending) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <LoadingIcon size="xl" className="text-text-subtlest" />
      </div>
    );
  }

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
            defaultValue={String(argValues.value ?? '')}
            onChange={(value) => setArgValues({ ...argValues, value })}
          />
        ) : (
          <DynamicForm
            autocompleteVariables
            autocompleteFunctions
            inputs={templateFunction.data.args}
            data={argValues}
            onChange={setArgValues}
            stateKey={`template_function.${templateFunction.data.name}`}
          />
        )}
      </div>
      <div className="px-6 border-t border-t-border py-3 bg-surface-highlight w-full flex flex-col gap-4">
        {previewType !== 'none' ? (
          <div className="w-full grid grid-cols-1 grid-rows-[auto_auto]">
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
            <div className="relative w-full max-h-[10rem]">
              <InlineCode
                className={classNames(
                  'block whitespace-pre-wrap !select-text cursor-text max-h-[10rem] overflow-auto hide-scrollbars !border-text-subtlest',
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
              </InlineCode>
              <div className="absolute right-0.5 top-0 bottom-0 flex items-center">
                <IconButton
                  size="xs"
                  icon="refresh"
                  className="text-text-subtle"
                  title="Refresh preview"
                  spin={rendered.isPending}
                  onClick={() => {
                    setRenderKey(new Date().toISOString());
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <span />
        )}
        <div className="flex justify-stretch w-full flex-grow gap-2 [&>*]:flex-1">
          {templateFunction.data.name === 'secure' && (
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

TemplateFunctionDialog.show = (
  fn: TemplateFunction,
  tagValue: string,
  startPos: number,
  view: EditorView,
) => {
  const initialTokens = parseTemplate(tagValue);
  showDialog({
    id: `template-function-${Math.random()}`, // Allow multiple at once
    size: 'md',
    className: 'h-[60rem]',
    noPadding: true,
    title: <InlineCode>{fn.name}(…)</InlineCode>,
    description: fn.description,
    render: ({ hide }) => {
      const model = jotaiStore.get(activeWorkspaceAtom);
      if (model == null) return null;
      return (
        <TemplateFunctionDialog
          templateFunction={fn}
          model={model}
          hide={hide}
          initialTokens={initialTokens}
          onChange={(insert) => {
            view.dispatch({
              changes: [{ from: startPos, to: startPos + tagValue.length, insert }],
            });
          }}
        />
      );
    },
  });
};
