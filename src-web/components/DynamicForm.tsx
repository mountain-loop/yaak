import type { Folder, HttpRequest } from '@yaakapp-internal/models';
import type {
  FormInput,
  FormInputCheckbox,
  FormInputFile,
  FormInputHttpRequest,
  FormInputSelect,
  FormInputText,
} from '@yaakapp-internal/plugins';
import { useCallback } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useFolders } from '../hooks/useFolders';
import { useHttpRequests } from '../hooks/useHttpRequests';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { Checkbox } from './core/Checkbox';
import { Input } from './core/Input';
import { Select } from './core/Select';
import { SelectFile } from './SelectFile';

// eslint-disable-next-line react-refresh/only-export-components
export const DYNAMIC_FORM_NULL_ARG = '__NULL__';

export function DynamicForm<T extends Record<string, string | boolean>>({
  config,
  data,
  onChange,
  useTemplating,
  stateKey,
}: {
  config: FormInput[];
  onChange: (value: T) => void;
  data: T;
  useTemplating?: boolean;
  stateKey: string;
}) {
  const setDataAttr = useCallback(
    (name: string, value: string | boolean | null) => {
      onChange({ ...data, [name]: value == null ? '__NULL__' : value });
    },
    [data, onChange],
  );

  return (
    <div>
      {config.map((a, i) => {
        switch (a.type) {
          case 'select':
            return (
              <SelectArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] ? String(data[a.name]) : '__ERROR__'}
              />
            );
          case 'text':
            return (
              <TextArg
                key={i}
                stateKey={stateKey}
                arg={a}
                useTemplating={useTemplating || false}
                onChange={(v) => setDataAttr(a.name, v)}
                value={data[a.name] ? String(data[a.name]) : ''}
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
                value={data[a.name] ? String(data[a.name]) : '__ERROR__'}
              />
            );
          case 'file':
            return (
              <FileArg
                key={i + stateKey}
                arg={a}
                onChange={(v) => setDataAttr(a.name, v)}
                filePath={data[a.name] ? String(data[a.name]) : '__ERROR__'}
              />
            );
        }
      })}
    </div>
  );
}

function TextArg({
  arg,
  onChange,
  value,
  useTemplating,
  stateKey,
}: {
  arg: FormInputText;
  value: string;
  onChange: (v: string) => void;
  useTemplating: boolean;
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
      defaultValue={value === DYNAMIC_FORM_NULL_ARG ? '' : value}
      require={!arg.optional}
      label={
        <>
          {arg.label ?? arg.name}
          {arg.optional && <span> (optional)</span>}
        </>
      }
      hideLabel={arg.label == null}
      placeholder={arg.placeholder ?? arg.defaultValue ?? ''}
      useTemplating={useTemplating}
      stateKey={stateKey}
      forceUpdateKey={stateKey}
    />
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
      value={value}
      options={[
        ...arg.options.map((a) => ({
          label: a.name + (arg.defaultValue === a.value ? ' (default)' : ''),
          value: a.value === arg.defaultValue ? DYNAMIC_FORM_NULL_ARG : a.value,
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
