import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import classNames from "classnames";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WrappedEnvironmentVariable } from "../../hooks/useEnvironmentVariables";
import { useRandomKey } from "../../hooks/useRandomKey";
import { useToggle } from "../../hooks/useToggle";
import { languageFromContentType } from "../../lib/contentType";
import { showDialog } from "../../lib/dialog";
import { computeSideForDragMove, DropMarker } from "@yaakapp-internal/ui";
import { showPrompt } from "../../lib/prompt";
import { SelectFile } from "../SelectFile";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import type { DropdownItem } from "./Dropdown";
import { Dropdown } from "./Dropdown";
import type { EditorProps } from "./Editor/Editor";
import type { GenericCompletionConfig } from "./Editor/genericCompletion";
import { Editor } from "./Editor/LazyEditor";
import { Icon } from "@yaakapp-internal/ui";
import { IconButton } from "./IconButton";
import type { InputHandle, InputProps } from "./Input";
import { Input } from "./Input";
import { ensurePairId } from "./PairEditor.util";
import type { RadioDropdownItem } from "./RadioDropdown";
import { RadioDropdown } from "./RadioDropdown";
import { platform } from "@yaakapp-internal/platform";

export interface PairEditorHandle {
  /**
   * Focus a row's name field once it's able to take focus. Focus can't land immediately when the
   * row isn't mounted yet or the editor is hidden — eg. sitting in a tab that's still becoming
   * active — so this retries for up to ~1s. A newer focus request cancels a pending one.
   */
  focusName(id: string): void;
  /** Focus a row's value field. See {@link PairEditorHandle.focusName} for timing. */
  focusValue(id: string): void;
}

/** ~1s at 60fps, plenty for a tab switch to land without spinning forever if it never does */
const MAX_FOCUS_ATTEMPTS = 60;

export type PairEditorProps = {
  allowFileValues?: boolean;
  allowMultilineValues?: boolean;
  className?: string;
  forcedEnvironmentId?: string;
  forceUpdateKey?: string;
  nameAutocomplete?: GenericCompletionConfig;
  nameAutocompleteFunctions?: boolean;
  nameAutocompleteVariables?: boolean;
  namePlaceholder?: string;
  nameValidate?: InputProps["validate"];
  noScroll?: boolean;
  onChange: (pairs: PairWithId[]) => void;
  pairs: EditablePair[];
  stateKey: InputProps["stateKey"];
  setRef?: (n: PairEditorHandle) => void;
  valueAutocomplete?: (name: string) => GenericCompletionConfig | undefined;
  valueAutocompleteFunctions?: boolean;
  valueAutocompleteVariables?: boolean | "environment";
  valuePlaceholder?: string;
  valueType?: InputProps["type"] | ((pair: Pair) => InputProps["type"]);
  valueValidate?: InputProps["validate"];
};

export type Pair = {
  id?: string;
  enabled?: boolean;
  name: string;
  value: string;
  contentType?: string;
  filename?: string;
  isFile?: boolean;
};

export type PairWithId = Pair & {
  id: string;
};

/**
 * A pair as handed to the editor. Adds behaviour that only the editor cares about, so the plain
 * `Pair` stays the shape that gets written to models.
 */
export type EditablePair = Pair & {
  /**
   * When set, name edits are held until the field blurs and then committed through this, instead
   * of calling `onChange` on every keystroke. Return false to reject the new name, which reverts
   * the field. For names that can't be written directly, like a URL path placeholder that lives
   * in the URL itself.
   */
  commitName?: (name: string) => boolean;
};

type EditablePairWithId = EditablePair & {
  id: string;
};

/** Strip the editor-only fields, so they can never reach a model write */
function toPairData({ commitName: _commitName, ...pair }: EditablePairWithId): PairWithId {
  return pair;
}

/** Max number of pairs to show before prompting the user to reveal the rest */
const MAX_INITIAL_PAIRS = 30;

// Keyed on `stateKey` so no state survives a change of owner. Row ids alone can't tell owners
// apart — two pair sets can share ids (eg. one duplicated from the other), and the same-rows
// fast path below would swap in the new data without rebuilding the row editors, leaving any
// still-focused input showing the old owner's text.
export function PairEditor(props: PairEditorProps) {
  return <PairEditorInner key={props.stateKey} {...props} />;
}

function PairEditorInner({
  allowFileValues,
  allowMultilineValues,
  className,
  forcedEnvironmentId,
  forceUpdateKey,
  nameAutocomplete,
  nameAutocompleteFunctions,
  nameAutocompleteVariables,
  namePlaceholder,
  nameValidate,
  noScroll,
  onChange,
  pairs: originalPairs,
  stateKey,
  valueAutocomplete,
  valueAutocompleteFunctions,
  valueAutocompleteVariables,
  valuePlaceholder,
  valueType,
  valueValidate,
  setRef,
}: PairEditorProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<EditablePairWithId | null>(null);
  const [pairs, setPairs] = useState<EditablePairWithId[]>([]);
  const [showAll, toggleShowAll] = useToggle(false);
  // NOTE: Use local force update key because we trigger an effect on forceUpdateKey change. If
  //  we simply pass forceUpdateKey to the editor, the data set by useEffect will be stale.
  const [localForceUpdateKey, regenerateLocalForceUpdateKey] = useRandomKey();

  const rowsRef = useRef<Record<string, RowHandle | null>>({});

  const pendingFocusFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingFocusFrame.current != null) cancelAnimationFrame(pendingFocusFrame.current);
    },
    [],
  );

  const focusWhenReady = useCallback((id: string, field: "name" | "value") => {
    if (pendingFocusFrame.current != null) cancelAnimationFrame(pendingFocusFrame.current);

    let attemptsLeft = MAX_FOCUS_ATTEMPTS;
    const attempt = () => {
      pendingFocusFrame.current = null;
      const row = rowsRef.current[id];
      const landed = field === "name" ? row?.focusName() : row?.focusValue();
      if (landed || --attemptsLeft <= 0) return;
      pendingFocusFrame.current = requestAnimationFrame(attempt);
    };
    attempt();
  }, []);

  const handle = useMemo<PairEditorHandle>(
    () => ({
      focusName(id: string) {
        focusWhenReady(id, "name");
      },
      focusValue(id: string) {
        focusWhenReady(id, "value");
      },
    }),
    [focusWhenReady],
  );

  const initPairEditorRow = useCallback(
    (id: string, n: RowHandle | null) => {
      const isLast = id === pairs[pairs.length - 1]?.id;
      if (isLast) return; // Never add the last pair

      rowsRef.current[id] = n;
      const validHandles = Object.values(rowsRef.current).filter((v) => v != null);

      // Use >= because more might be added if an ID of one changes (eg. editing placeholder in URL regenerates fresh pairs every keystroke)
      const ready = validHandles.length >= pairs.length - 1;
      if (ready) {
        setRef?.(handle);
      }
    },
    [handle, pairs, setRef],
  );

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only care about forceUpdateKey
  useEffect(() => {
    // Remove empty headers on initial render and ensure they all have valid ids (pairs didn't use to have IDs)
    const newPairs: EditablePairWithId[] = [];
    for (let i = 0; i < originalPairs.length; i++) {
      const p = originalPairs[i];
      if (!p) continue; // Make TS happy
      if (isPairEmpty(p)) continue;
      newPairs.push(ensurePairId(p));
    }

    // When the reset holds the exact same rows (eg. renaming a URL path placeholder, which keeps
    // every row id), swap the data in without rebuilding the row editors. Unfocused inputs re-seed
    // themselves when `defaultValue` changes, and a rebuild would drop the user's focus and
    // selection — like tabbing from a placeholder's name into its value.
    const trailingPair = pairs[pairs.length - 1];
    const sameRows =
      trailingPair != null &&
      isPairEmpty(trailingPair) &&
      pairs.length === newPairs.length + 1 &&
      newPairs.every((p, i) => p.id === pairs[i]?.id);
    if (sameRows) {
      setPairs([...newPairs, trailingPair]);
      return;
    }

    // Add empty last pair if there is none
    const lastPair = newPairs[newPairs.length - 1];
    if (lastPair == null || !isPairEmpty(lastPair)) {
      newPairs.push(emptyPair());
    }

    setPairs(newPairs);
    regenerateLocalForceUpdateKey();
  }, [forceUpdateKey]);

  const setPairsAndSave = useCallback(
    (fn: (pairs: EditablePairWithId[]) => EditablePairWithId[]) => {
      setPairs((oldPairs) => {
        const pairs = fn(oldPairs);
        onChange(pairs.map(toPairData));
        return pairs;
      });
    },
    [onChange],
  );

  const handleChange = useCallback(
    (pair: EditablePairWithId) =>
      setPairsAndSave((pairs) => pairs.map((p) => (pair.id !== p.id ? p : pair))),
    [setPairsAndSave],
  );

  const handleDelete = useCallback(
    (pair: Pair, focusPrevious: boolean) => {
      if (focusPrevious) {
        const index = pairs.findIndex((p) => p.id === pair.id);
        const id = pairs[index - 1]?.id ?? null;
        rowsRef.current[id ?? "n/a"]?.focusName();
      }
      return setPairsAndSave((oldPairs) => oldPairs.filter((p) => p.id !== pair.id));
    },
    [setPairsAndSave, pairs],
  );

  const handleFocusName = useCallback(
    (pair: Pair) => {
      const isLast = pair.id === pairs[pairs.length - 1]?.id;
      if (isLast) setPairs([...pairs, emptyPair()]);
    },
    [pairs],
  );

  const handleFocusValue = useCallback(
    (pair: Pair) => {
      const isLast = pair.id === pairs[pairs.length - 1]?.id;
      if (isLast) setPairs([...pairs, emptyPair()]);
    },
    [pairs],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // dnd-kit: show the “between rows” marker while hovering
  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const overId = e.over?.id as string | undefined;
      if (!overId) return setHoveredIndex(null);

      const overPair = pairs.find((p) => p.id === overId);
      if (overPair == null) return setHoveredIndex(null);

      const side = computeSideForDragMove(overPair.id, e);
      const overIndex = pairs.findIndex((p) => p.id === overId);
      const hoveredIndex = overIndex + (side === "before" ? 0 : 1);

      setHoveredIndex(hoveredIndex);
    },
    [pairs],
  );

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const pair = pairs.find((p) => p.id === e.active.id);
      setIsDragging(pair ?? null);
    },
    [pairs],
  );

  const onDragCancel = useCallback(() => setIsDragging(null), []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setIsDragging(null);
      setHoveredIndex(null);
      const activeId = e.active.id as string | undefined;
      const overId = e.over?.id as string | undefined;
      if (!activeId || !overId) return;

      const from = pairs.findIndex((p) => p.id === activeId);
      const baseTo = pairs.findIndex((p) => p.id === overId);
      const to = hoveredIndex ?? (baseTo === -1 ? from : baseTo);

      if (from !== -1 && to !== -1 && from !== to) {
        setPairsAndSave((ps) => {
          const next = [...ps];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) return ps; // Make TS happy
          next.splice(to > from ? to - 1 : to, 0, moved);
          return next;
        });
      }
    },
    [pairs, hoveredIndex, setPairsAndSave],
  );

  return (
    <div
      className={classNames(
        className,
        "@container relative",
        "pb-2 mb-auto h-full",
        !noScroll && "overflow-y-auto max-h-full",
        // Move over the width of the drag handle
        "-mr-2 pr-2",
        // Pad to make room for the drag divider
        "pt-0.5",
        "grid grid-rows-[auto_1fr]",
      )}
    >
      <div>
        <DndContext
          autoScroll
          sensors={sensors}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          collisionDetection={pointerWithin}
        >
          {pairs.map((p, i) => {
            if (!showAll && i > MAX_INITIAL_PAIRS) return null;

            const isLast = i === pairs.length - 1;
            return (
              <Fragment key={p.id}>
                {hoveredIndex === i && <DropMarker />}
                <PairEditorRow
                  setRef={initPairEditorRow}
                  allowFileValues={allowFileValues}
                  allowMultilineValues={allowMultilineValues}
                  className="py-1"
                  forcedEnvironmentId={forcedEnvironmentId}
                  forceUpdateKey={localForceUpdateKey}
                  index={i}
                  isLast={isLast}
                  isDraggingGlobal={!!isDragging}
                  nameAutocomplete={nameAutocomplete}
                  nameAutocompleteFunctions={nameAutocompleteFunctions}
                  nameAutocompleteVariables={nameAutocompleteVariables}
                  namePlaceholder={namePlaceholder}
                  nameValidate={nameValidate}
                  onChange={handleChange}
                  onDelete={handleDelete}
                  onFocusName={handleFocusName}
                  onFocusValue={handleFocusValue}
                  pair={p}
                  stateKey={stateKey}
                  valueAutocomplete={valueAutocomplete}
                  valueAutocompleteFunctions={valueAutocompleteFunctions}
                  valueAutocompleteVariables={valueAutocompleteVariables}
                  valuePlaceholder={valuePlaceholder}
                  valueType={valueType}
                  valueValidate={valueValidate}
                />
              </Fragment>
            );
          })}
          {!showAll && pairs.length > MAX_INITIAL_PAIRS && (
            <Button onClick={toggleShowAll} variant="border" className="m-2" size="xs">
              Show {pairs.length - MAX_INITIAL_PAIRS} More
            </Button>
          )}
          <DragOverlay dropAnimation={null}>
            {isDragging && (
              <PairEditorRow
                namePlaceholder={namePlaceholder}
                valuePlaceholder={valuePlaceholder}
                className="opacity-80"
                pair={isDragging}
                index={0}
                stateKey={null}
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <div
        // There's a weird bug where clicking below one of the above Codemirror inputs will cause
        // it to focus. Putting this element here prevents that
        aria-hidden
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

type PairEditorRowProps = {
  className?: string;
  pair: EditablePairWithId;
  forceFocusNamePairId?: string | null;
  forceFocusValuePairId?: string | null;
  onChange?: (pair: EditablePairWithId) => void;
  onDelete?: (pair: EditablePairWithId, focusPrevious: boolean) => void;
  onFocusName?: (pair: EditablePairWithId) => void;
  onFocusValue?: (pair: EditablePairWithId) => void;
  onSubmit?: (pair: EditablePairWithId) => void;
  isLast?: boolean;
  disabled?: boolean;
  disableDrag?: boolean;
  index: number;
  isDraggingGlobal?: boolean;
  setRef?: (id: string, n: RowHandle | null) => void;
} & Pick<
  PairEditorProps,
  | "allowFileValues"
  | "allowMultilineValues"
  | "forcedEnvironmentId"
  | "forceUpdateKey"
  | "nameAutocomplete"
  | "nameAutocompleteVariables"
  | "namePlaceholder"
  | "nameValidate"
  | "nameAutocompleteFunctions"
  | "stateKey"
  | "valueAutocomplete"
  | "valueAutocompleteFunctions"
  | "valueAutocompleteVariables"
  | "valuePlaceholder"
  | "valueType"
  | "valueValidate"
>;

interface RowHandle {
  focusName(): boolean;
  focusValue(): boolean;
}

export function PairEditorRow({
  allowFileValues,
  allowMultilineValues,
  className,
  disableDrag,
  disabled,
  forceUpdateKey,
  forcedEnvironmentId,
  index,
  isLast,
  nameAutocomplete,
  nameAutocompleteFunctions,
  nameAutocompleteVariables,
  namePlaceholder,
  nameValidate,
  isDraggingGlobal,
  onChange,
  onDelete,
  onFocusName,
  onFocusValue,
  pair,
  stateKey,
  valueAutocomplete,
  valueAutocompleteFunctions,
  valueAutocompleteVariables,
  valuePlaceholder,
  valueType,
  valueValidate,
  setRef,
}: PairEditorRowProps) {
  const nameInputRef = useRef<InputHandle>(null);
  const valueInputRef = useRef<InputHandle>(null);
  const handle = useRef<RowHandle>({
    focusName() {
      nameInputRef.current?.focus();
      return nameInputRef.current?.isFocused() ?? false;
    },
    focusValue() {
      valueInputRef.current?.focus();
      return valueInputRef.current?.isFocused() ?? false;
    },
  });

  const initNameInputRef = useCallback(
    (n: InputHandle | null) => {
      nameInputRef.current = n;
      if (nameInputRef.current && valueInputRef.current) {
        setRef?.(pair.id, handle.current);
      }
    },
    [pair.id, setRef],
  );

  const initValueInputRef = useCallback(
    (n: InputHandle | null) => {
      valueInputRef.current = n;
      if (nameInputRef.current && valueInputRef.current) {
        setRef?.(pair.id, handle.current);
      }
    },
    [pair.id, setRef],
  );

  const handleFocusName = useCallback(() => onFocusName?.(pair), [onFocusName, pair]);
  const handleFocusValue = useCallback(() => onFocusValue?.(pair), [onFocusValue, pair]);
  const handleDelete = useCallback(() => onDelete?.(pair, false), [onDelete, pair]);

  const handleChangeEnabled = useMemo(
    () => (enabled: boolean) => onChange?.({ ...pair, enabled }),
    [onChange, pair],
  );

  // The name being typed into a deferred-commit field, before it's committed or reverted
  const pendingName = useRef<string | null>(null);

  const handleChangeName = useMemo(
    () => (name: string) => {
      // Keep the edit local until commit. Writing on every keystroke would reset the editor from
      // beneath the cursor, since the pairs are derived from the name being edited.
      if (pair.commitName != null) pendingName.current = name;
      else onChange?.({ ...pair, name });
    },
    [onChange, pair],
  );

  const revertName = useCallback(() => {
    const nameInput = nameInputRef.current;
    if (nameInput != null) {
      const changes = { from: 0, to: nameInput.value().length, insert: pair.name };
      nameInput.dispatch({ changes });
    }
    pendingName.current = null;
  }, [pair.name]);

  const handleBlurName = useCallback(() => {
    if (pair.commitName == null) return;

    const name = pendingName.current;
    pendingName.current = null;
    if (name == null || name === pair.name) return;
    if (!pair.commitName(name)) revertName();
  }, [pair, revertName]);

  const handleChangeValueText = useMemo(
    () => (value: string) => onChange?.({ ...pair, value, isFile: false }),
    [onChange, pair],
  );

  const handleChangeValueFile = useMemo(
    () =>
      ({ filePath }: { filePath: string | null }) =>
        onChange?.({ ...pair, value: filePath ?? "", isFile: true }),
    [onChange, pair],
  );

  const handleChangeValueContentType = useMemo(
    () => (contentType: string) => onChange?.({ ...pair, contentType }),
    [onChange, pair],
  );

  const handleChangeValueFilename = useMemo(
    () => (filename: string) => onChange?.({ ...pair, filename }),
    [onChange, pair],
  );

  const handleEditMultiLineValue = useCallback(
    () =>
      showDialog({
        id: "pair-edit-multiline",
        size: "dynamic",
        title: <>Edit {pair.name}</>,
        render: ({ hide }) => (
          <MultilineEditDialog
            hide={hide}
            onChange={handleChangeValueText}
            defaultValue={pair.value}
            contentType={pair.contentType ?? null}
          />
        ),
      }),
    [handleChangeValueText, pair.contentType, pair.name, pair.value],
  );

  const defaultItems = useMemo(
    (): DropdownItem[] => [
      {
        label: "Edit Multi-line",
        onSelect: handleEditMultiLineValue,
        hidden: !allowMultilineValues,
      },
      {
        label: "Delete",
        onSelect: handleDelete,
        color: "danger",
      },
    ],
    [allowMultilineValues, handleDelete, handleEditMultiLineValue],
  );

  const { attributes, listeners, setNodeRef: setDraggableRef } = useDraggable({ id: pair.id });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: pair.id });

  // Filter out the current pair name
  const valueAutocompleteVariablesFiltered = useMemo<EditorProps["autocompleteVariables"]>(() => {
    if (valueAutocompleteVariables === "environment") {
      return (v: WrappedEnvironmentVariable): boolean => v.variable.name !== pair.name;
    }
    return valueAutocompleteVariables;
  }, [pair.name, valueAutocompleteVariables]);

  const handleSetRef = useCallback(
    (n: HTMLDivElement | null) => {
      setDraggableRef(n);
      setDroppableRef(n);
    },
    [setDraggableRef, setDroppableRef],
  );

  // Skip the trailing placeholder row. It exists to start a new pair, so a picker there would
  // imply it's already a real row. `Input` handles the rest, including having no options to show.
  const showOptionsPicker = !isLast;

  return (
    <div
      ref={handleSetRef}
      className={classNames(
        className,
        "group/pair-row grid grid-cols-[auto_auto_minmax(0,1fr)_auto]",
        "grid-rows-1 items-center",
        !pair.enabled && "opacity-60",
      )}
    >
      <Checkbox
        hideLabel
        title={pair.enabled ? "Disable item" : "Enable item"}
        disabled={isLast || disabled}
        checked={isLast ? false : !!pair.enabled}
        className={classNames(isLast && "opacity-disabled!")}
        onChange={handleChangeEnabled}
      />
      {!isLast && !disableDrag ? (
        <div
          {...attributes}
          {...listeners}
          className={classNames(
            "py-2 h-7 w-4 flex items-center",
            "justify-center opacity-0 group-hover/pair-row:opacity-70",
          )}
        >
          <Icon size="sm" icon="grip_vertical" className="pointer-events-none" />
        </div>
      ) : (
        <span className="w-4" />
      )}
      <div
        className={classNames(
          "grid items-center",
          "@xs:gap-2 @xs:grid-rows-1! @xs:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]!",
          "gap-0.5 grid-cols-1 grid-rows-2",
        )}
      >
        <Input
          setRef={initNameInputRef}
          hideLabel
          stateKey={`name.${pair.id}.${stateKey}`}
          disabled={disabled}
          wrapLines={false}
          readOnly={isDraggingGlobal}
          size="sm"
          required={!isLast && !!pair.enabled && !!pair.value}
          validate={nameValidate}
          forcedEnvironmentId={forcedEnvironmentId}
          forceUpdateKey={forceUpdateKey}
          containerClassName={classNames("bg-surface", isLast && "border-dashed")}
          defaultValue={pair.name}
          label="Name"
          name={`name[${index}]`}
          onBlur={handleBlurName}
          onChange={handleChangeName}
          onFocus={handleFocusName}
          placeholder={namePlaceholder ?? "name"}
          autocomplete={nameAutocomplete}
          autocompleteVariables={nameAutocompleteVariables}
          autocompleteFunctions={nameAutocompleteFunctions}
          showOptionsPicker={showOptionsPicker}
        />
        <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] gap-1 items-center">
          {pair.isFile ? (
            <SelectFile
              disabled={disabled}
              inline
              size="xs"
              filePath={pair.value}
              nameOverride={pair.filename || null}
              onChange={handleChangeValueFile}
            />
          ) : pair.value.includes("\n") ? (
            <Button
              color="secondary"
              size="sm"
              onClick={handleEditMultiLineValue}
              title={pair.value}
              className="text-xs font-mono"
            >
              {pair.value.split("\n").join(" ")}
            </Button>
          ) : (
            <Input
              setRef={initValueInputRef}
              hideLabel
              stateKey={`value.${pair.id}.${stateKey}`}
              wrapLines={false}
              size="sm"
              disabled={disabled}
              readOnly={isDraggingGlobal}
              containerClassName={classNames("bg-surface", isLast && "border-dashed")}
              validate={valueValidate}
              forcedEnvironmentId={forcedEnvironmentId}
              forceUpdateKey={forceUpdateKey}
              defaultValue={pair.value}
              label="Value"
              name={`value[${index}]`}
              onChange={handleChangeValueText}
              onFocus={handleFocusValue}
              type={isLast ? "text" : typeof valueType === "function" ? valueType(pair) : valueType}
              placeholder={valuePlaceholder ?? "value"}
              autocomplete={valueAutocomplete?.(pair.name)}
              autocompleteFunctions={valueAutocompleteFunctions}
              autocompleteVariables={valueAutocompleteVariablesFiltered}
              showOptionsPicker={showOptionsPicker}
            />
          )}
        </div>
      </div>
      {allowFileValues ? (
        <FileActionsDropdown
          pair={pair}
          onChangeFile={handleChangeValueFile}
          onChangeText={handleChangeValueText}
          onChangeContentType={handleChangeValueContentType}
          onChangeFilename={handleChangeValueFilename}
          onDelete={handleDelete}
          editMultiLine={handleEditMultiLineValue}
        />
      ) : (
        <Dropdown items={defaultItems}>
          <IconButton
            iconSize="sm"
            size="xs"
            // Ellipsis rather than a chevron: the name and value fields now carry chevrons for
            // picking a suggestion, and this menu acts on the row instead of filling in a field.
            icon={isLast || disabled ? "empty" : "ellipsis_vertical"}
            title="More actions"
            className="text-text-subtlest"
          />
        </Dropdown>
      )}
    </div>
  );
}

const fileItems: RadioDropdownItem<string>[] = [
  { label: "Text", value: "text" },
  { label: "File", value: "file" },
];

function FileActionsDropdown({
  pair,
  onChangeFile,
  onChangeText,
  onChangeContentType,
  onChangeFilename,
  onDelete,
  editMultiLine,
}: {
  pair: Pair;
  onChangeFile: ({ filePath }: { filePath: string | null }) => void;
  onChangeText: (text: string) => void;
  onChangeContentType: (contentType: string) => void;
  onChangeFilename: (filename: string) => void;
  onDelete: () => void;
  editMultiLine: () => void;
}) {
  const onChange = useCallback(
    (v: string) => {
      if (v === "file") onChangeFile({ filePath: "" });
      else onChangeText("");
    },
    [onChangeFile, onChangeText],
  );

  const itemsAfter = useMemo<DropdownItem[]>(
    () => [
      {
        label: "Edit Multi-Line",
        leftSlot: <Icon icon="file_code" />,
        hidden: pair.isFile,
        onSelect: editMultiLine,
      },
      {
        label: "Set Content-Type",
        leftSlot: <Icon icon="pencil" />,
        onSelect: async () => {
          const contentType = await showPrompt({
            id: "content-type",
            title: "Override Content-Type",
            label: "Content-Type",
            required: false,
            placeholder: "text/plain",
            defaultValue: pair.contentType ?? "",
            confirmText: "Set",
            description: "Leave blank to auto-detect",
          });
          if (contentType == null) return;
          onChangeContentType(contentType);
        },
      },
      {
        label: "Set File Name",
        leftSlot: <Icon icon="file_code" />,
        onSelect: async () => {
          console.log("PAIR", pair);
          const defaultFilename = await platform.files.basename(pair.value ?? "");
          const filename = await showPrompt({
            id: "filename",
            title: "Override Filename",
            label: "Filename",
            required: false,
            placeholder: defaultFilename ?? "myfile.png",
            defaultValue: pair.filename,
            confirmText: "Set",
            description: "Leave blank to use the name of the selected file",
          });
          if (filename == null) return;
          onChangeFilename(filename);
        },
      },
      {
        label: "Unset File",
        leftSlot: <Icon icon="x" />,
        hidden: pair.isFile,
        onSelect: async () => {
          onChangeFile({ filePath: null });
        },
      },
      {
        label: "Delete",
        onSelect: onDelete,
        variant: "danger",
        leftSlot: <Icon icon="trash" />,
        color: "danger",
      },
    ],
    [
      editMultiLine,
      onChangeContentType,
      onChangeFile,
      onDelete,
      pair.contentType,
      pair.isFile,
      onChangeFilename,
      pair.filename,
      pair,
    ],
  );

  return (
    <RadioDropdown
      value={pair.isFile ? "file" : "text"}
      onChange={onChange}
      items={fileItems}
      itemsAfter={itemsAfter}
    >
      <IconButton
        iconSize="sm"
        size="xs"
        // Matches the plain row menu, so the actions column reads the same for file and text rows
        icon="ellipsis_vertical"
        title="Select form data type"
        className="text-text-subtlest"
      />
    </RadioDropdown>
  );
}

function emptyPair(): EditablePairWithId {
  return ensurePairId({ enabled: true, name: "", value: "" });
}

function isPairEmpty(pair: Pair): boolean {
  return !pair.name && !pair.value;
}

function MultilineEditDialog({
  defaultValue,
  contentType,
  onChange,
  hide,
}: {
  defaultValue: string;
  contentType: string | null;
  onChange: (value: string) => void;
  hide: () => void;
}) {
  const [value, setValue] = useState<string>(defaultValue);
  const language = languageFromContentType(contentType, value);
  return (
    <div className="w-screen max-w-160 h-[50vh] max-h-full grid grid-rows-[minmax(0,1fr)_auto]">
      <Editor
        heightMode="auto"
        defaultValue={defaultValue}
        language={language}
        onChange={setValue}
        stateKey={null}
        autocompleteFunctions
        autocompleteVariables
      />
      <div>
        <Button
          color="primary"
          className="ml-auto my-2"
          onClick={() => {
            onChange(value);
            hide();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
