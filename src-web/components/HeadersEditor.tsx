import type { HttpRequestHeader } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import { charsets } from '../lib/data/charsets';
import { connections } from '../lib/data/connections';
import { encodings } from '../lib/data/encodings';
import { headerNames } from '../lib/data/headerNames';
import { mimeTypes } from '../lib/data/mimetypes';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import type { PairEditorProps } from './core/PairEditor';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';

type Props = {
  forceUpdateKey: string;
  headers: HttpRequestHeader[];
  stateKey: string;
  onChange: (headers: HttpRequestHeader[]) => void;
};

export function HeadersEditor({ stateKey, headers, onChange, forceUpdateKey }: Props) {
  return (
    <PairOrBulkEditor
      preferenceName="headers"
      stateKey={stateKey}
      valueAutocompleteVariables
      nameAutocompleteVariables
      pairs={headers}
      onChange={onChange}
      forceUpdateKey={forceUpdateKey}
      nameValidate={validateHttpHeader}
      nameAutocomplete={nameAutocomplete}
      valueAutocomplete={valueAutocomplete}
      namePlaceholder="Header-Name"
    />
  );
}

const MIN_MATCH = 3;

const headerOptionsMap: Record<string, string[]> = {
  'content-type': mimeTypes,
  accept: ['*/*', ...mimeTypes],
  'accept-encoding': encodings,
  connection: connections,
  'accept-charset': charsets,
};

const valueAutocomplete = (headerName: string): GenericCompletionConfig | undefined => {
  const name = headerName.toLowerCase().trim();
  const options: GenericCompletionOption[] =
    headerOptionsMap[name]?.map((o) => ({
      label: o,
      type: 'constant',
      boost: 1, // Put above other completions
    })) ?? [];
  return { minMatch: MIN_MATCH, options };
};

const nameAutocomplete: PairEditorProps['nameAutocomplete'] = {
  minMatch: MIN_MATCH,
  options: headerNames.map((t) =>
    typeof t === 'string'
      ? {
          label: t,
          type: 'constant',
          boost: 1, // Put above other completions
        }
      : {
          ...t,
          boost: 1, // Put above other completions
        },
  ),
};

const validateHttpHeader = (v: string) => {
  if (v === '') {
    return true;
  }

  // Template strings are not allowed so we replace them with a valid example string
  const withoutTemplateStrings = v.replace(/\$\{\[\s*[^\]\s]+\s*]}/gi, '123');
  return withoutTemplateStrings.match(/^[a-zA-Z0-9-_]+$/) !== null;
};
