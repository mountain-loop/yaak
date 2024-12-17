import classNames from 'classnames';
import type { EditorView } from 'codemirror';
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import type { XYCoord } from 'react-dnd';
import { useDrag, useDrop } from 'react-dnd';
import { v4 as uuid } from 'uuid';
import { usePrompt } from '../../hooks/usePrompt';
import { DropMarker } from '../DropMarker';
import { SelectFile } from '../SelectFile';
import { Checkbox } from './Checkbox';
import { Dropdown } from './Dropdown';
import type { GenericCompletionConfig } from './Editor/genericCompletion';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import type { InputProps } from './Input';
import { Input } from './Input';
import { PlainInput } from './PlainInput';
import { RadioDropdown } from './RadioDropdown';

export interface PairEditorRef {
  focusValue(index: number): void;
}

export type PairEditorProps = {
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  forceUpdateKey?: string;
  className?: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  valueType?: 'text' | 'password';
  nameAutocomplete?: GenericCompletionConfig;
  valueAutocomplete?: (name: string) => GenericCompletionConfig | undefined;
  nameAutocompleteVariables?: boolean;
  valueAutocompleteVariables?: boolean;
  allowFileValues?: boolean;
  nameValidate?: InputProps['validate'];
  valueValidate?: InputProps['validate'];
  noScroll?: boolean;
};

export type Pair = {
  id?: string;
  enabled?: boolean;
  name: string;
  value: string;
  contentType?: string;
  isFile?: boolean;
  readOnlyName?: boolean;
};

type PairContainer = {
  pair: Pair;
  id: string;
};

export const PairEditor = forwardRef<PairEditorRef, PairEditorProps>(function PairEditor(
  {
    className,
    forceUpdateKey,
    nameAutocomplete,
    nameAutocompleteVariables,
    namePlaceholder,
    nameValidate,
    valueType,
    onChange,
    noScroll,
    pairs: originalPairs,
    valueAutocomplete,
    valueAutocompleteVariables,
    valuePlaceholder,
    valueValidate,
    allowFileValues,
  }: PairEditorProps,
  ref,
) {
  const [forceFocusNamePairId, setForceFocusNamePairId] = useState<string | null>(null);
  const [forceFocusValuePairId, setForceFocusValuePairId] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pairs, setPairs] = useState<PairContainer[]>(() => {
    // Remove empty headers on initial render
    const nonEmpty = originalPairs.filter((h) => !(h.name === '' && h.value === ''));
    const pairs = nonEmpty.map((pair) => newPairContainer(pair));
    return [...pairs, newPairContainer()];
  });

  useImperativeHandle(ref, () => ({
    focusValue(index: number) {
      const id = pairs[index]?.id ?? 'n/a';
      setForceFocusValuePairId(id);
    },
  }));

  useEffect(() => {
    // Remove empty headers on initial render
    // TODO: Make this not refresh the entire editor when forceUpdateKey changes, using some
    //  sort of diff method or deterministic IDs based on array index and update key
    const nonEmpty = originalPairs.filter((h) => !(h.name === '' && h.value === ''));
    const pairs = nonEmpty.map((pair) => newPairContainer(pair));
    setPairs([...pairs, newPairContainer()]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceUpdateKey]);

  const setPairsAndSave = useCallback(
    (fn: (pairs: PairContainer[]) => PairContainer[]) => {
      setPairs((oldPairs) => {
        const pairs = fn(oldPairs).map((p) => p.pair);
        onChange(pairs);
        return fn(oldPairs);
      });
    },
    [onChange],
  );

  // Clipboard parsing function
  const parseClipboardData = (data: string): { name: string; value: string }[] => {
    const lines = data.split("\n").filter(Boolean);
    return lines.map((line) => {
      const [name, value] = line.split(/[=:]/); // Handle = or : separator
      return {
        name: (name ?? '').trim(),
        value: (value ?? '').trim(),
      };
    });
  };

  // Function to handle paste action
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const clipboardText = await readText(); // Read clipboard using Tauri plugin
      const parsedPairs = parseClipboardData(clipboardText);
      setPairsAndSave((oldPairs) => [
        ...oldPairs.slice(0, -1), // Remove the empty last row
        ...parsedPairs.map((pair) => newPairContainer(pair)),
        newPairContainer(), // Append a new empty row
      ]);
    } catch (error) {
      console.error('Failed to paste clipboard data:', error);
    }
  }, [setPairsAndSave]);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        event.preventDefault(); // Prevent default browser paste
        await handlePasteFromClipboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);

  }, [handlePasteFromClipboard]);

  const handleMove = useCallback<PairEditorRowProps['onMove']>(
    (id, side) => {
      const dragIndex = pairs.findIndex((r) => r.id === id);
      setHoveredIndex(side === 'above' ? dragIndex : dragIndex + 1);
    },
    [pairs],
  );

  const handleEnd = useCallback<PairEditorRowProps['onEnd']>(
    (id: string) => {
      if (hoveredIndex === null) return;
      setHoveredIndex(null);

      setPairsAndSave((pairs) => {
        const index = pairs.findIndex((p) => p.id === id);
        const pair = pairs[index];
        if (pair === undefined) return pairs;

        const newPairs = pairs.filter((p) => p.id !== id);
        if (hoveredIndex > index) newPairs.splice(hoveredIndex - 1, 0, pair);
        else newPairs.splice(hoveredIndex, 0, pair);
        return newPairs;
      });
    },
    [hoveredIndex, setPairsAndSave],
  );

  const handleChange = useCallback(
    (pair: PairContainer) =>
      setPairsAndSave((pairs) => pairs.map((p) => (pair.id !== p.id ? p : pair))),
    [setPairsAndSave],
  );

  const handleDelete = useCallback(
    (pair: PairContainer, focusPrevious: boolean) => {
      if (focusPrevious) {
        const index = pairs.findIndex((p) => p.id === pair.id);
        const id = pairs[index - 1]?.id ?? null;
        setForceFocusNamePairId(id);
      }
      return setPairsAndSave((oldPairs) => oldPairs.filter((p) => p.id !== pair.id));
    },
    [setPairsAndSave, setForceFocusNamePairId, pairs],
  );

  const handleFocus = useCallback(
    (pair: PairContainer) =>
      setPairs((pairs) => {
        setForceFocusNamePairId(null); // Remove focus override when something focused
        setForceFocusValuePairId(null); // Remove focus override when something focused
        const isLast = pair.id === pairs[pairs.length - 1]?.id;
        if (isLast) {
          const newPair = newPairContainer();
          const prevPair = pairs[pairs.length - 1];
          setForceFocusNamePairId(prevPair?.id ?? null);
          return [...pairs, newPair];
        } else {
          return pairs;
        }
      }),
    [],
  );

  // Ensure there's always at least one pair
  useEffect(() => {
    if (pairs.length === 0) {
      setPairs((pairs) => [...pairs, newPairContainer()]);
    }
  }, [pairs]);

  return (
    <div
      className={classNames(
        className,
        '@container relative',
        'pb-2 mb-auto h-full',
        !noScroll && 'overflow-y-auto max-h-full',
        // Move over the width of the drag handle
        '-ml-3 -mr-2 pr-2',
        // Pad to make room for the drag divider
        'pt-0.5',
      )}
    >
      {pairs.map((p, i) => {
        const isLast = i === pairs.length - 1;
        return (
          <Fragment key={p.id}>
            {hoveredIndex === i && <DropMarker />}
            <PairEditorRow
              pairContainer={p}
              className="py-1"
              isLast={isLast}
              allowFileValues={allowFileValues}
              nameAutocompleteVariables={nameAutocompleteVariables}
              valueAutocompleteVariables={valueAutocompleteVariables}
              valueType={valueType}
              forceFocusNamePairId={forceFocusNamePairId}
              forceFocusValuePairId={forceFocusValuePairId}
              forceUpdateKey={forceUpdateKey}
              nameAutocomplete={nameAutocomplete}
              valueAutocomplete={valueAutocomplete}
              namePlaceholder={namePlaceholder}
              valuePlaceholder={valuePlaceholder}
              nameValidate={nameValidate}
              valueValidate={valueValidate}
              onChange={handleChange}
              onFocus={handleFocus}
              onDelete={handleDelete}
              onEnd={handleEnd}
              onMove={handleMove}
              index={i}
            />
          </Fragment>
        );
      })}
    </div>
  );
});

enum ItemTypes {
  ROW = 'pair-row',
}

type PairEditorRowProps = {
  className?: string;
  pairContainer: PairContainer;
  forceFocusNamePairId?: string | null;
  forceFocusValuePairId?: string | null;
  onMove: (id: string, side: 'above' | 'below') => void;
  onEnd: (id: string) => void;
  onChange: (pair: PairContainer) => void;
  onDelete?: (pair: PairContainer, focusPrevious: boolean) => void;
  onFocus?: (pair: PairContainer) => void;
  onSubmit?: (pair: PairContainer) => void;
  isLast?: boolean;
  index: number;
} & Pick<
  PairEditorProps,
  | 'nameAutocomplete'
  | 'valueAutocomplete'
  | 'nameAutocompleteVariables'
  | 'valueAutocompleteVariables'
  | 'valueType'
  | 'namePlaceholder'
  | 'valuePlaceholder'
  | 'nameValidate'
  | 'valueValidate'
  | 'forceUpdateKey'
  | 'allowFileValues'
>;

function PairEditorRow({
  allowFileValues,
  className,
  forceFocusNamePairId,
  forceFocusValuePairId,
  forceUpdateKey,
  isLast,
  index,
  nameAutocomplete,
  nameAutocompleteVariables,
  namePlaceholder,
  nameValidate,
  onChange,
  onDelete,
  onEnd,
  onFocus,
  onMove,
  pairContainer,
  valueAutocomplete,
  valueAutocompleteVariables,
  valuePlaceholder,
  valueType,
  valueValidate,
}: PairEditorRowProps) {
  const { id } = pairContainer;
  const ref = useRef<HTMLDivElement>(null);
  const prompt = usePrompt();
  const nameInputRef = useRef<EditorView>(null);
  const valueInputRef = useRef<EditorView>(null);

  useEffect(() => {
    if (forceFocusNamePairId === pairContainer.id) {
      nameInputRef.current?.focus();
    }
  }, [forceFocusNamePairId, pairContainer.id]);

  useEffect(() => {
    if (forceFocusValuePairId === pairContainer.id) {
      valueInputRef.current?.focus();
    }
  }, [forceFocusValuePairId, pairContainer.id]);

  const handleChangeEnabled = useMemo(
    () => (enabled: boolean) => onChange({ id, pair: { ...pairContainer.pair, enabled } }),
    [id, onChange, pairContainer.pair],
  );

  const handleChangeName = useMemo(
    () => (name: string) => onChange({ id, pair: { ...pairContainer.pair, name } }),
    [onChange, id, pairContainer.pair],
  );

  const handleChangeValueText = useMemo(
    () => (value: string) =>
      onChange({ id, pair: { ...pairContainer.pair, value, isFile: false } }),
    [onChange, id, pairContainer.pair],
  );

  const handleChangeValueFile = useMemo(
    () =>
      ({ filePath }: { filePath: string | null }) =>
        onChange({
          id,
          pair: { ...pairContainer.pair, value: filePath ?? '', isFile: true },
        }),
    [onChange, id, pairContainer.pair],
  );

  const handleChangeValueContentType = useMemo(
    () => (contentType: string) => onChange({ id, pair: { ...pairContainer.pair, contentType } }),
    [onChange, id, pairContainer.pair],
  );

  const handleFocus = useCallback(() => onFocus?.(pairContainer), [onFocus, pairContainer]);
  const handleDelete = useCallback(
    () => onDelete?.(pairContainer, false),
    [onDelete, pairContainer],
  );

  const [, connectDrop] = useDrop<PairContainer>(
    {
      accept: ItemTypes.ROW,
      hover: (_, monitor) => {
        if (!ref.current) return;
        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;
        onMove(pairContainer.id, hoverClientY < hoverMiddleY ? 'above' : 'below');
      },
    },
    [onMove],
  );

  const [, connectDrag] = useDrag(
    {
      type: ItemTypes.ROW,
      item: () => pairContainer,
      collect: (m) => ({ isDragging: m.isDragging() }),
      end: () => onEnd(pairContainer.id),
    },
    [pairContainer, onEnd],
  );

  connectDrag(ref);
  connectDrop(ref);

  return (
    <div
      ref={ref}
      className={classNames(
        className,
        'group grid grid-cols-[auto_auto_minmax(0,1fr)_auto]',
        'grid-rows-1 items-center',
        !pairContainer.pair.enabled && 'opacity-60',
      )}
    >
      {!isLast ? (
        <div
          className={classNames(
            'py-2 h-7 w-3 flex items-center',
            'justify-center opacity-0 group-hover:opacity-70',
          )}
        >
          <Icon size="sm" icon="grip_vertical" className="pointer-events-none" />
        </div>
      ) : (
        <span className="w-3" />
      )}
      <Checkbox
        hideLabel
        title={pairContainer.pair.enabled ? 'Disable item' : 'Enable item'}
        disabled={isLast}
        checked={isLast ? false : !!pairContainer.pair.enabled}
        className={classNames('pr-2', isLast && '!opacity-disabled')}
        onChange={handleChangeEnabled}
      />
      <div
        className={classNames(
          'grid items-center',
          '@xs:gap-2 @xs:!grid-rows-1 @xs:!grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
          'gap-0.5 grid-cols-1 grid-rows-2',
        )}
      >
        {isLast ? (
          // Use PlainInput for last ones because there's a unique bug where clicking below
          // the Codemirror input focuses it.
          <PlainInput
            hideLabel
            size="sm"
            containerClassName={classNames(isLast && 'border-dashed')}
            label="Name"
            name={`name[${index}]`}
            onFocus={handleFocus}
            placeholder={namePlaceholder ?? 'name'}
          />
        ) : (
          <Input
            ref={nameInputRef}
            hideLabel
            useTemplating
            wrapLines={false}
            readOnly={pairContainer.pair.readOnlyName}
            size="sm"
            require={!isLast && !!pairContainer.pair.enabled && !!pairContainer.pair.value}
            validate={nameValidate}
            forceUpdateKey={forceUpdateKey}
            containerClassName={classNames(isLast && 'border-dashed')}
            defaultValue={pairContainer.pair.name}
            label="Name"
            name={`name[${index}]`}
            onChange={handleChangeName}
            onFocus={handleFocus}
            placeholder={namePlaceholder ?? 'name'}
            autocomplete={nameAutocomplete}
            autocompleteVariables={nameAutocompleteVariables}
          />
        )}
        <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] gap-1 items-center">
          {pairContainer.pair.isFile ? (
            <SelectFile
              inline
              size="xs"
              filePath={pairContainer.pair.value}
              onChange={handleChangeValueFile}
            />
          ) : isLast ? (
            // Use PlainInput for last ones because there's a unique bug where clicking below
            // the Codemirror input focuses it.
            <PlainInput
              hideLabel
              size="sm"
              containerClassName={classNames(isLast && 'border-dashed')}
              label="Value"
              name={`value[${index}]`}
              onFocus={handleFocus}
              placeholder={valuePlaceholder ?? 'value'}
            />
          ) : (
            <Input
              ref={valueInputRef}
              hideLabel
              useTemplating
              wrapLines={false}
              size="sm"
              containerClassName={classNames(isLast && 'border-dashed')}
              validate={valueValidate}
              forceUpdateKey={forceUpdateKey}
              defaultValue={pairContainer.pair.value}
              label="Value"
              name={`value[${index}]`}
              onChange={handleChangeValueText}
              onFocus={handleFocus}
              type={isLast ? 'text' : valueType}
              placeholder={valuePlaceholder ?? 'value'}
              autocomplete={valueAutocomplete?.(pairContainer.pair.name)}
              autocompleteVariables={valueAutocompleteVariables}
            />
          )}
        </div>
      </div>
      {allowFileValues ? (
        <RadioDropdown
          value={pairContainer.pair.isFile ? 'file' : 'text'}
          onChange={(v) => {
            if (v === 'file') handleChangeValueFile({ filePath: '' });
            else handleChangeValueText('');
          }}
          items={[
            { label: 'Text', value: 'text' },
            { label: 'File', value: 'file' },
          ]}
          extraItems={[
            {
              key: 'mime',
              label: 'Set Content-Type',
              leftSlot: <Icon icon="pencil" />,
              hidden: !pairContainer.pair.isFile,
              onSelect: async () => {
                const contentType = await prompt({
                  id: 'content-type',
                  require: false,
                  title: 'Override Content-Type',
                  label: 'Content-Type',
                  placeholder: 'text/plain',
                  defaultValue: pairContainer.pair.contentType ?? '',
                  confirmText: 'Set',
                  description: 'Leave blank to auto-detect',
                });
                if (contentType == null) return;
                handleChangeValueContentType(contentType);
              },
            },
            {
              key: 'clear-file',
              label: 'Unset File',
              leftSlot: <Icon icon="x" />,
              hidden: !pairContainer.pair.isFile,
              onSelect: async () => {
                handleChangeValueFile({ filePath: null });
              },
            },
            {
              key: 'delete',
              label: 'Delete',
              onSelect: handleDelete,
              variant: 'danger',
              leftSlot: <Icon icon="trash" />,
            },
          ]}
        >
          <IconButton
            iconSize="sm"
            size="xs"
            icon={isLast ? 'empty' : 'chevron_down'}
            title="Select form data type"
          />
        </RadioDropdown>
      ) : (
        <Dropdown
          items={[
            {
              key: 'delete',
              label: 'Delete',
              onSelect: handleDelete,
              variant: 'danger',
            },
          ]}
        >
          <IconButton
            iconSize="sm"
            size="xs"
            icon={isLast ? 'empty' : 'chevron_down'}
            title="Select form data type"
          />
        </Dropdown>
      )}
    </div>
  );
}

const newPairContainer = (initialPair?: Pair): PairContainer => {
  const id = initialPair?.id ?? uuid();
  const pair = initialPair ?? { name: '', value: '', enabled: true, isFile: false };
  return { id, pair };
};
