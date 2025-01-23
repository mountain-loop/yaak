import type { Folder, HttpRequest } from '@yaakapp-internal/models';
import type {
  FormInput,
  FormInputCheckbox,
  FormInputEditor,
  FormInputFile,
  FormInputHttpRequest,
  FormInputSelect,
  FormInputText,
} from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { useCallback } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useFolders } from '../hooks/useFolders';
import { useHttpRequests } from '../hooks/useHttpRequests';
import { capitalize } from '../lib/capitalize';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { Checkbox } from './core/Checkbox';
import { Editor } from './core/Editor/Editor';
import { Input } from './core/Input';
import { Label } from './core/Label';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

// eslint-disable-next-line react-refresh/only-export-components
export const DYNAMIC_FORM_NULL_ARG = '__NULL__';

export function DynamicForm<T extends Record<string, string | boolean>>({
  config,
  data,
  onChange,
  useTemplating,
  autocompleteVariables,
  stateKey,
}: {
  config: FormInput[];
  onChange: (value: T) => void;
  data: T;
  useTemplating?: boolean;
  autocompleteVariables?: boolean;
  stateKey: string;
}) {
  const setDataAttr = useCallback(
    (name: string, value: string | boolean | null) => {
      onChange({ ...data, [name]: value == DYNAMIC_FORM_NULL_ARG ? undefined : value });
    },
    [data, onChange],
  );

  return (
    <VStack space={3} className="h-full overflow-auto">
      {config.map((a, i) => {
        if (a.hidden) {
          return null;
        }

        switch (a.type) {
          case 'select':
            return (
              <SelectArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                value={
                  data[a.name] ? String(data[a.name]) : (a.defaultValue ?? DYNAMIC_FORM_NULL_ARG)
                }
              />
            );
          case 'text':
            return (
              <TextArg
                key={i}
                stateKey={stateKey}
                arg={a}
                useTemplating={useTemplating || false}
                autocompleteVariables={autocompleteVariables || false}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] ? String(data[a.name]) : (a.defaultValue ?? '')}
              />
            );
          case 'editor':
            return (
              <EditorArg
                key={i}
                stateKey={stateKey}
                arg={a}
                useTemplating={useTemplating || false}
                autocompleteVariables={autocompleteVariables || false}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] ? String(data[a.name]) : (a.defaultValue ?? '')}
              />
            );
          case 'checkbox':
            return (
              <CheckboxArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] !== undefined ? data[a.name] === true : false}
              />
            );
          case 'http_request':
            return (
              <HttpRequestArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] ? String(data[a.name]) : DYNAMIC_FORM_NULL_ARG}
              />
            );
          case 'file':
            return (
              <FileArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                filePath={data[a.name] ? String(data[a.name]) : DYNAMIC_FORM_NULL_ARG}
              />
            );
        }
      })}
    </VStack>
  );
}

function TextArg({
  arg,
  onChange,
  value,
  useTemplating,
  autocompleteVariables,
  stateKey,
}: {
  arg: FormInputText;
  value: string;
  onChange: (v: string) => void;
  useTemplating: boolean;
  autocompleteVariables: boolean;
  stateKey: string;
}) {
  const handleChange = useCallback(
    (value: string) => {
      onChange(value === '' ? DYNAMIC_FORM_NULL_ARG : value);
    },
    [onChange],
  );

  return (
    <Input
      name={arg.name}
      onChange={handleChange}
      defaultValue={value === DYNAMIC_FORM_NULL_ARG ? arg.defaultValue : value}
      required={!arg.optional}
      type={arg.password ? 'password' : 'text'}
      label={arg.label ?? arg.name}
      hideLabel={arg.label == null}
      placeholder={arg.placeholder ?? arg.defaultValue ?? ''}
      autocomplete={arg.completionOptions ? { options: arg.completionOptions } : undefined}
      useTemplating={useTemplating}
      autocompleteVariables={autocompleteVariables}
      stateKey={stateKey}
      forceUpdateKey={stateKey}
    />
  );
}

function EditorArg({
  arg,
  onChange,
  value,
  useTemplating,
  autocompleteVariables,
  stateKey,
}: {
  arg: FormInputEditor;
  value: string;
  onChange: (v: string) => void;
  useTemplating: boolean;
  autocompleteVariables: boolean;
  stateKey: string;
}) {
  const handleChange = useCallback(
    (value: string) => {
      onChange(value === '' ? DYNAMIC_FORM_NULL_ARG : value);
    },
    [onChange],
  );

  const id = `input-${arg.name}`;

  return (
    <div className=" w-full grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <Label
        htmlFor={id}
        optional={arg.optional}
        visuallyHidden={arg.hideLabel}
        tags={arg.language ? [capitalize(arg.language)] : undefined}
      >
        {arg.label}
      </Label>
      <Editor
        id={id}
        className={classNames(
          'border border-border rounded-md overflow-hidden px-2 py-1.5',
          'focus-within:border-border-focus',
          'max-h-[15rem]', // So it doesn't take up too much space
        )}
        autocomplete={arg.completionOptions ? { options: arg.completionOptions } : undefined}
        language={arg.language}
        onChange={handleChange}
        heightMode="auto"
        defaultValue={value === DYNAMIC_FORM_NULL_ARG ? arg.defaultValue : value}
        placeholder={arg.placeholder ?? arg.defaultValue ?? ''}
        useTemplating={useTemplating}
        autocompleteVariables={autocompleteVariables}
        stateKey={stateKey}
        forceUpdateKey={stateKey}
        hideGutter
      />
    </div>
  );
}

function SelectArg({
  arg,
  value,
  onChange,
}: {
  arg: FormInputSelect;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={arg.label ?? arg.name}
      name={arg.name}
      onChange={onChange}
      hideLabel={arg.hideLabel}
      value={value}
      options={[
        ...arg.options.map((a) => ({
          label: a.name,
          value: a.value,
        })),
      ]}
    />
  );
}

function FileArg({
  arg,
  filePath,
  onChange,
}: {
  arg: FormInputFile;
  filePath: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <SelectFile
      onChange={({ filePath }) => onChange(filePath)}
      filePath={filePath === '__NULL__' ? null : filePath}
      directory={!!arg.directory}
    />
  );
}

function HttpRequestArg({
  arg,
  value,
  onChange,
}: {
  arg: FormInputHttpRequest;
  value: string;
  onChange: (v: string) => void;
}) {
  const folders = useFolders();
  const httpRequests = useHttpRequests();
  const activeRequest = useActiveRequest();
  return (
    <Select
      label={arg.label ?? arg.name}
      name={arg.name}
      onChange={onChange}
      value={value}
      options={[
        ...httpRequests.map((r) => {
          return {
            label:
              buildRequestBreadcrumbs(r, folders).join(' / ') +
              (r.id == activeRequest?.id ? ' (current)' : ''),
            value: r.id,
          };
        }),
      ]}
    />
  );
}

function buildRequestBreadcrumbs(request: HttpRequest, folders: Folder[]): string[] {
  const ancestors: (HttpRequest | Folder)[] = [request];

  const next = () => {
    const latest = ancestors[0];
    if (latest == null) return [];

    const parent = folders.find((f) => f.id === latest.folderId);
    if (parent == null) return;

    ancestors.unshift(parent);
    next();
  };
  next();

  return ancestors.map((a) => (a.model === 'folder' ? a.name : fallbackRequestName(a)));
}

function CheckboxArg({
  arg,
  onChange,
  value,
}: {
  arg: FormInputCheckbox;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Checkbox
      onChange={onChange}
      checked={value}
      title={arg.label ?? arg.name}
      hideLabel={arg.label == null}
    />
  );
}
