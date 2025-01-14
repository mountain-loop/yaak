import { useCallback, useMemo } from 'react';
import { generateId } from '../../lib/generateId';
import { Editor } from './Editor/Editor';
import type { PairEditorProps } from './PairEditor';

type Props = PairEditorProps;

export function BulkPairEditor({
  pairs,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  forceUpdateKey,
  stateKey,
}: Props) {
  const pairsText = useMemo(() => {
    return pairs
      .filter((p) => !(p.name.trim() === '' && p.value.trim() === ''))
      .map((p) => `${p.name}: ${p.value}`)
      .join('\n');
  }, [pairs]);

  const handleChange = useCallback(
    (text: string) => {
      const pairs = text
        .split('\n')
        .filter((l: string) => l.trim())
        .map(lineToPair);
      onChange(pairs);
    },
    [onChange],
  );

  return (
    <Editor
      useTemplating
      autocompleteVariables
      stateKey={`bulk_pair.${stateKey}`}
      forceUpdateKey={forceUpdateKey}
      placeholder={`${namePlaceholder ?? 'name'}: ${valuePlaceholder ?? 'value'}`}
      defaultValue={pairsText}
      language="pairs"
      onChange={handleChange}
    />
  );
}

function lineToPair(line: string): PairEditorProps['pairs'][0] {
  const [, name, value] = line.match(/^(:?[^:]+):\s+(.*)$/) ?? [];

  const pair: PairEditorProps['pairs'][0] = {
    enabled: true,
    name: (name ?? '').trim(),
    value: (value ?? '').trim(),
    id: generateId(),
  };
  return pair;
}
