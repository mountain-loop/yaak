import type { TemplateFunction } from '@yaakapp-internal/plugins';
import type { FnArg, Tokens } from '@yaakapp-internal/templates';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import { useTemplateTokensToString } from '../hooks/useTemplateTokensToString';
import { useToggle } from '../hooks/useToggle';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { HStack, VStack } from './core/Stacks';
import { DYNAMIC_FORM_NULL_ARG, DynamicForm } from './DynamicForm';
import { IconButton } from './core/IconButton';
import { Banner } from './core/Banner';

interface Props {
  templateFunction: TemplateFunction;
  initialTokens: Tokens;
  hide: () => void;
  onChange: (insert: string) => void;
}

export function TemplateFunctionDialog({ templateFunction, hide, initialTokens, onChange }: Props) {
  const [showSecretsInPreview, toggleShowSecretsInPreview] = useToggle(false);
  const [argValues, setArgValues] = useState<Record<string, string | boolean>>(() => {
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

    return initial;
  });

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

  const debouncedTagText = useDebouncedValue(tagText.data ?? '', 200);
  const rendered = useRenderTemplate(debouncedTagText);
  const tooLarge = rendered.data ? rendered.data.length > 10000 : false;
  const dataContainsSecrets = useMemo(() => {
    for (const [name, value] of Object.entries(argValues)) {
      const isPassword = templateFunction.args.some(
        (a) => a.type === 'text' && a.password && a.name === name,
      );
      if (isPassword && typeof value === 'string' && value && rendered.data?.includes(value)) {
        return true;
      }
    }
    return false;
    // Only update this on rendered data change to keep secrets hidden on input change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.data]);

  return (
    <VStack className="pb-3" space={4}>
      <h1 className="font-mono !text-base">{templateFunction.name}(…)</h1>
      <DynamicForm
        autocompleteVariables
        autocompleteFunctions
        inputs={templateFunction.args}
        data={argValues}
        onChange={setArgValues}
        stateKey={`template_function.${templateFunction.name}`}
      />
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
              <span className="italic text-text-subtle">------ sensitive values hidden ------</span>
            ) : tooLarge ? (
              'too large to preview'
            ) : (
              rendered.data || <>&nbsp;</>
            )}
          </InlineCode>
        )}
      </VStack>
      <Button color="primary" onClick={handleDone}>
        Done
      </Button>
    </VStack>
  );
}
