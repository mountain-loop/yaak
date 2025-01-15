import type { Tokens } from '@yaakapp-internal/templates';
import { useCallback, useMemo, useState } from 'react';
import { useActiveEnvironmentVariables } from '../hooks/useActiveEnvironmentVariables';
import { useRenderTemplate } from '../hooks/useRenderTemplate';
import { useTemplateTokensToString } from '../hooks/useTemplateTokensToString';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';

interface Props {
  initialTokens: Tokens;
  hide: () => void;
  onChange: (rawTag: string) => void;
}

export function TemplateVariableDialog({ hide, onChange, initialTokens }: Props) {
  const variables = useActiveEnvironmentVariables();
  const [selectedVariableName, setSelectedVariableName] = useState<string>(() => {
    return initialTokens.tokens[0]?.type === 'tag' && initialTokens.tokens[0]?.val.type === 'var'
      ? initialTokens.tokens[0]?.val.name
      : ''; // Should never happen
  });

  const tokens: Tokens = useMemo(() => {
    const selectedVariable = variables.find((v) => v.name === selectedVariableName);
    return {
      tokens: [
        {
          type: 'tag',
          val: {
            type: 'var',
            name: selectedVariable?.name ?? '',
          },
        },
      ],
    };
  }, [selectedVariableName, variables]);

  const tagText = useTemplateTokensToString(tokens);
  const handleDone = useCallback(async () => {
    if (tagText.data != null) {
      onChange(tagText.data);
    }
    hide();
  }, [hide, onChange, tagText.data]);

  const rendered = useRenderTemplate(tagText.data ?? '');

  return (
    <VStack className="pb-3" space={4}>
      <VStack space={2}>
        <Select
          name="variable"
          label="Select Variable"
          value={selectedVariableName}
          options={variables.map((v) => ({ label: v.name, value: v.name }))}
          onChange={setSelectedVariableName}
        />
      </VStack>
      <VStack>
        <div className="text-sm text-text-subtle">Preview</div>
        <InlineCode className="select-text cursor-text">{rendered.data}</InlineCode>
      </VStack>
      <Button color="primary" onClick={handleDone}>
        Done
      </Button>
    </VStack>
  );
}
