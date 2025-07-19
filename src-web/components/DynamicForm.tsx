import type { Folder, HttpRequest } from '@yaakapp-internal/models';
import { foldersAtom, httpRequestsAtom } from '@yaakapp-internal/models';
import type {
  FormInput,
  FormInputCheckbox,
  FormInputEditor,
  FormInputFile,
  FormInputHttpRequest,
  FormInputSelect,
  FormInputText,
  JsonPrimitive,
} from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useRandomKey } from '../hooks/useRandomKey';
import { capitalize } from '../lib/capitalize';
import { showDialog } from '../lib/dialog';
import { resolvedModelName } from '../lib/resolvedModelName';
import { Banner } from './core/Banner';
import { Checkbox } from './core/Checkbox';
import { DetailsBanner } from './core/DetailsBanner';
import { Editor } from './core/Editor/Editor';
import { IconButton } from './core/IconButton';
import { Input } from './core/Input';
import { Label } from './core/Label';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';
import { Markdown } from './Markdown';
import { SelectFile } from './SelectFile';

// eslint-disable-next-line react-refresh/only-export-components
export const DYNAMIC_FORM_NULL_ARG = '__NULL__';
const INPUT_SIZE = 'sm';

interface Props<T> {
  inputs: FormInput[] | undefined | null;
  onChange: (value: T) => void;
  data: T;
  autocompleteFunctions?: boolean;
  autocompleteVariables?: boolean;
  stateKey: string;
  disabled?: boolean;
}

export function DynamicForm<T extends Record<string, JsonPrimitive>>({
  inputs,
  data,
  onChange,
  autocompleteVariables,
  autocompleteFunctions,
  stateKey,
  disabled,
}: Props<T>) {
  const setDataAttr = useCallback(
    (name: string, value: JsonPrimitive) => {
      onChange({ ...data, [name]: value == DYNAMIC_FORM_NULL_ARG ? undefined : value });
    },
    [data, onChange],
  );

  return (
    <FormInputs
      disabled={disabled}
      inputs={inputs}
      setDataAttr={setDataAttr}
      stateKey={stateKey}
      autocompleteFunctions={autocompleteFunctions}
      autocompleteVariables={autocompleteVariables}
      data={data}
      className="pb-4" // Pad the bottom to look nice
    />
  );
}

function FormInputs<T extends Record<string, JsonPrimitive>>({
  inputs,
  autocompleteFunctions,
  autocompleteVariables,
  stateKey,
  setDataAttr,
  data,
  disabled,
  className,
}: Pick<
  Props<T>,
  'inputs' | 'autocompleteFunctions' | 'autocompleteVariables' | 'stateKey' | 'data'
> & {
  setDataAttr: (name: string, value: JsonPrimitive) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <VStack
      space={3}
      className={classNames(
        className,
        'h-full overflow-auto',
        'pr-1', // A bit of space between inputs and scrollbar
      )}
    >
      {inputs?.map((input, i) => {
        if ('hidden' in input && input.hidden) {
          return null;
        }

        if ('disabled' in input && disabled != null) {
          input.disabled = disabled;
        }

        switch (input.type) {
          case 'select':
            return (
              <SelectArg
                key={i + stateKey}
                arg={input}
                onChange={(v) => setDataAttr(input.name, v)}
                value={
                  data[input.name]
                    ? String(data[input.name])
                    : (input.defaultValue ?? DYNAMIC_FORM_NULL_ARG)
                }
              />
            );
          case 'text':
            return (
              <TextArg
                key={i}
                stateKey={stateKey}
                arg={input}
                autocompleteFunctions={autocompleteFunctions || false}
                autocompleteVariables={autocompleteVariables || false}
                onChange={(v) => setDataAttr(input.name, v)}
                value={
                  data[input.name] != null ? String(data[input.name]) : (input.defaultValue ?? '')
                }
              />
            );
          case 'editor':
            return (
              <EditorArg
                key={i}
                stateKey={stateKey}
                arg={input}
                autocompleteFunctions={autocompleteFunctions || false}
                autocompleteVariables={autocompleteVariables || false}
                onChange={(v) => setDataAttr(input.name, v)}
                value={
                  data[input.name] != null ? String(data[input.name]) : (input.defaultValue ?? '')
                }
              />
            );
          case 'checkbox':
            return (
              <CheckboxArg
                key={i + stateKey}
                arg={input}
                onChange={(v) => setDataAttr(input.name, v)}
                value={data[input.name] != null ? data[input.name] === true : false}
              />
            );
          case 'http_request':
            return (
              <HttpRequestArg
                key={i + stateKey}
                arg={input}
                onChange={(v) => setDataAttr(input.name, v)}
                value={data[input.name] != null ? String(data[input.name]) : DYNAMIC_FORM_NULL_ARG}
              />
            );
          case 'file':
            return (
              <FileArg
                key={i + stateKey}
                arg={input}
                onChange={(v) => setDataAttr(input.name, v)}
                filePath={
                  data[input.name] != null ? String(data[input.name]) : DYNAMIC_FORM_NULL_ARG
                }
              />
            );
          case 'accordion':
            return (
              <DetailsBanner
                key={i}
                summary={input.label}
                className={classNames(disabled && 'opacity-disabled')}
              >
                <div className="mb-3 px-3">
                  <FormInputs
                    data={data}
                    disabled={disabled}
                    inputs={input.inputs}
                    setDataAttr={setDataAttr}
                    stateKey={stateKey}
                    autocompleteFunctions={autocompleteFunctions || false}
                    autocompleteVariables={autocompleteVariables}
                  />
                </div>
              </DetailsBanner>
            );
          case 'banner':
            return (
              <Banner
                key={i}
                color={input.color}
                className={classNames(disabled && 'opacity-disabled')}
              >
                <FormInputs
                  data={data}
                  disabled={disabled}
                  inputs={input.inputs}
                  setDataAttr={setDataAttr}
                  stateKey={stateKey}
                  autocompleteFunctions={autocompleteFunctions || false}
                  autocompleteVariables={autocompleteVariables}
                />
              </Banner>
            );
          case 'markdown':
            return <Markdown>{input.content}</Markdown>;
        }
      })}
    </VStack>
  );
}

function TextArg({
  arg,
  onChange,
  value,
  autocompleteFunctions,
  autocompleteVariables,
  stateKey,
}: {
  arg: FormInputText;
  value: string;
  onChange: (v: string) => void;
  autocompleteFunctions: boolean;
  autocompleteVariables: boolean;
  stateKey: string;
}) {
  return (
    <Input
      name={arg.name}
      multiLine={arg.multiLine}
      onChange={onChange}
      defaultValue={value === DYNAMIC_FORM_NULL_ARG ? arg.defaultValue : value}
      required={!arg.optional}
      disabled={arg.disabled}
      help={arg.description}
      type={arg.password ? 'password' : 'text'}
      label={arg.label ?? arg.name}
      size={INPUT_SIZE}
      hideLabel={arg.label == null}
      placeholder={arg.placeholder ?? undefined}
      autocomplete={arg.completionOptions ? { options: arg.completionOptions } : undefined}
      autocompleteFunctions={autocompleteFunctions}
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
  autocompleteFunctions,
  autocompleteVariables,
  stateKey,
}: {
  arg: FormInputEditor;
  value: string;
  onChange: (v: string) => void;
  autocompleteFunctions: boolean;
  autocompleteVariables: boolean;
  stateKey: string;
}) {
  const id = `input-${arg.name}`;

  // Read-only editor force refresh for every defaultValue change
  // Should this be built into the <Editor/> component?
  const [popoutKey, regeneratePopoutKey] = useRandomKey();
  const forceUpdateKey = popoutKey + (arg.readOnly ? arg.defaultValue + stateKey : stateKey);

  return (
    <div className="w-full grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <Label
        htmlFor={id}
        required={!arg.optional}
        visuallyHidden={arg.hideLabel}
        help={arg.description}
        tags={arg.language ? [capitalize(arg.language)] : undefined}
      >
        {arg.label}
      </Label>
      <div
        className={classNames(
          'border border-border rounded-md overflow-hidden px-2 py-1',
          'focus-within:border-border-focus',
          'max-h-[10rem]', // So it doesn't take up too much space
        )}
      >
        <Editor
          id={id}
          autocomplete={arg.completionOptions ? { options: arg.completionOptions } : undefined}
          disabled={arg.disabled}
          language={arg.language}
          onChange={onChange}
          heightMode="auto"
          defaultValue={value === DYNAMIC_FORM_NULL_ARG ? arg.defaultValue : value}
          placeholder={arg.placeholder ?? undefined}
          autocompleteFunctions={autocompleteFunctions}
          autocompleteVariables={autocompleteVariables}
          stateKey={stateKey}
          forceUpdateKey={forceUpdateKey}
          actions={
            <div>
              <IconButton
                variant="border"
                size="sm"
                className="my-0.5 opacity-60 group-hover:opacity-100"
                icon="expand"
                title="Pop out to large editor"
                onClick={() => {
                  showDialog({
                    id: 'id',
                    size: 'full',
                    title: 'Edit Value',
                    className: '!max-w-[50rem] !max-h-[60rem]',
                    description: (
                      <Label
                        htmlFor={id}
                        required={!arg.optional}
                        visuallyHidden={arg.hideLabel}
                        help={arg.description}
                        tags={arg.language ? [capitalize(arg.language)] : undefined}
                      >
                        {arg.label}
                      </Label>
                    ),
                    onClose() {
                      // Force the main editor to update on close
                      regeneratePopoutKey();
                    },
                    render() {
                      return (
                        <Editor
                          id={id}
                          autocomplete={
                            arg.completionOptions ? { options: arg.completionOptions } : undefined
                          }
                          disabled={arg.disabled}
                          language={arg.language}
                          onChange={onChange}
                          defaultValue={value === DYNAMIC_FORM_NULL_ARG ? arg.defaultValue : value}
                          placeholder={arg.placeholder ?? undefined}
                          autocompleteFunctions={autocompleteFunctions}
                          autocompleteVariables={autocompleteVariables}
                          stateKey={stateKey}
                          forceUpdateKey={forceUpdateKey}
                        />
                      );
                    },
                  });
                }}
              />
            </div>
          }
          hideGutter
        />
      </div>
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
      help={arg.description}
      onChange={onChange}
      hideLabel={arg.hideLabel}
      value={value}
      size={INPUT_SIZE}
      disabled={arg.disabled}
      options={arg.options}
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
      disabled={arg.disabled}
      help={arg.description}
      onChange={({ filePath }) => onChange(filePath)}
      filePath={filePath === DYNAMIC_FORM_NULL_ARG ? null : filePath}
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
  const folders = useAtomValue(foldersAtom);
  const httpRequests = useAtomValue(httpRequestsAtom);
  const activeHttpRequest = useActiveRequest('http_request');

  useEffect(() => {
    if (value === DYNAMIC_FORM_NULL_ARG && activeHttpRequest) {
      onChange(activeHttpRequest.id);
    }
  }, [activeHttpRequest, onChange, value]);

  return (
    <Select
      label={arg.label ?? arg.name}
      name={arg.name}
      onChange={onChange}
      help={arg.description}
      value={value}
      disabled={arg.disabled}
      options={[
        ...httpRequests.map((r) => {
          return {
            label:
              buildRequestBreadcrumbs(r, folders).join(' / ') +
              (r.id == activeHttpRequest?.id ? ' (current)' : ''),
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

  return ancestors.map((a) => (a.model === 'folder' ? a.name : resolvedModelName(a)));
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
      help={arg.description}
      disabled={arg.disabled}
      title={arg.label ?? arg.name}
      hideLabel={arg.label == null}
    />
  );
}
