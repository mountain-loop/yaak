/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Color } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { fuzzyMatch } from 'fuzzbunny';
import type {
  GraphQLField,
  GraphQLInputField,
  GraphQLNamedType,
  GraphQLSchema,
  GraphQLType,
} from 'graphql';
import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNamedType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import { useAtomValue } from 'jotai';
import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useContainerSize } from '../../hooks/useContainerQuery';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import { jotaiStore } from '../../lib/jotai';
import { Banner } from '../core/Banner';
import { CountBadge } from '../core/CountBadge';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { PlainInput } from '../core/PlainInput';
import { Markdown } from '../Markdown';
import { showGraphQLDocExplorerAtom } from './graphqlAtoms';

interface Props {
  style?: CSSProperties;
  schema: GraphQLSchema;
  requestId: string;
  className?: string;
}

type ExplorerItem =
  | { kind: 'type'; type: GraphQLType; from: ExplorerItem }
  | { kind: 'field'; type: GraphQLField<any, any>; from: ExplorerItem }
  | { kind: 'input_field'; type: GraphQLInputField; from: ExplorerItem }
  | null;

export const GraphQLDocsExplorer = memo(function GraphQLDocsExplorer({
  style,
  schema,
  requestId,
  className,
}: Props) {
  const [activeItem, setActiveItem] = useState<ExplorerItem>(null);

  const qryType = schema.getQueryType();
  const mutType = schema.getMutationType();
  const subType = schema.getSubscriptionType();
  const showField = useAtomValue(showGraphQLDocExplorerAtom)[requestId] ?? null;

  useEffect(() => {
    if (showField === null) {
      setActiveItem(null);
    } else {
      const isRootParentType =
        showField.parentType === 'Query' ||
        showField.parentType === 'Mutation' ||
        showField.parentType === 'Subscription';
      walkTypeGraph(schema, null, (t, from) => {
        if (
          showField.field === t.name &&
          // For input fields, CodeMirror seems to set parentType to the root type of the field they belong to.
          (isRootParentType || from?.name === showField.parentType)
        ) {
          setActiveItem(toExplorerItem(t, toExplorerItem(from, null)));
          return false;
        } else if (showField.type === t.name && from?.name === showField.parentType) {
          setActiveItem(toExplorerItem(t, toExplorerItem(from, null)));
          return false;
        } else {
          return true;
        }
      });
    }
  }, [schema, showField]);

  const qryItem: ExplorerItem = qryType ? { kind: 'type', type: qryType, from: null } : null;
  const mutItem: ExplorerItem = mutType ? { kind: 'type', type: mutType, from: null } : null;
  const subItem: ExplorerItem = subType ? { kind: 'type', type: subType, from: null } : null;
  const allTypes = schema.getTypeMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);

  return (
    <div ref={containerRef} className={classNames(className, 'py-3 mx-3')} style={style}>
      <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full border border-dashed border-border rounded-lg overflow-hidden">
        <GraphQLExplorerHeader
          containerHeight={containerSize.height}
          item={activeItem}
          onClose={() => {
            jotaiStore.set(showGraphQLDocExplorerAtom, (v) => ({ ...v, [requestId]: undefined }));
          }}
          setItem={setActiveItem}
          schema={schema}
        />
        {activeItem == null ? (
          <div className="flex flex-col gap-3 overflow-y-auto h-full w-full px-3 pb-6">
            <Heading>Root Types</Heading>
            <GqlTypeRow
              name={{ value: 'query', color: 'primary' }}
              item={qryItem}
              setItem={setActiveItem}
              className="!my-0"
            />
            <GqlTypeRow
              name={{ value: 'mutation', color: 'primary' }}
              item={mutItem}
              setItem={setActiveItem}
              className="!my-0"
            />
            <GqlTypeRow
              name={{ value: 'subscription', color: 'primary' }}
              item={subItem}
              setItem={setActiveItem}
              className="!my-0"
            />
            <Subheading count={Object.keys(allTypes).length}>All Schema Types</Subheading>
            <DocMarkdown>{schema.description ?? null}</DocMarkdown>
            <div className="flex flex-col gap-1">
              {Object.keys(allTypes).map((typeName) => {
                const t = allTypes[typeName]!;
                return (
                  <GqlTypeLink
                    key={t.name}
                    color="notice"
                    item={{ kind: 'type', type: t, from: null }}
                    setItem={setActiveItem}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div
            key={activeItem.type.toString()} // Reset scroll position to top
            className="overflow-y-auto h-full w-full p-3 grid grid-cols-[minmax(0,1fr)]"
          >
            <GqlTypeInfo item={activeItem} setItem={setActiveItem} schema={schema} />
          </div>
        )}
      </div>
    </div>
  );
});

function GraphQLExplorerHeader({
  item,
  setItem,
  schema,
  onClose,
  containerHeight,
}: {
  item: ExplorerItem;
  setItem: (t: ExplorerItem) => void;
  schema: GraphQLSchema;
  onClose: () => void;
  containerHeight: number;
}) {
  const findIt = (t: ExplorerItem): ExplorerItem[] => {
    if (t == null) return [null];
    return [...findIt(t.from), t];
  };
  const crumbs = findIt(item);
  return (
    <nav className="pl-2 pr-1 h-lg grid grid-rows-1 grid-cols-[minmax(0,1fr)_auto] items-center min-w-0 gap-1">
      <div className="@container w-full relative pl-2 pr-1 h-lg grid grid-rows-1 grid-cols-[minmax(0,min-content)_auto] items-center gap-1">
        <div className="whitespace-nowrap flex items-center gap-2 text-text-subtle text-sm overflow-x-auto hide-scrollbars">
          <Icon icon="book_open_text" />
          {crumbs.map((crumb, i) => {
            return (
              <Fragment key={i}>
                {i > 0 && <Icon icon="chevron_right" className="text-text-subtlest" />}
                {crumb === item || item == null ? (
                  <GqlTypeLabel noTruncate item={item} />
                ) : crumb === item ? null : (
                  <GqlTypeLink
                    key={i}
                    noTruncate
                    item={crumb}
                    setItem={setItem}
                    className="!font-sans !text-sm flex-shrink-0"
                  />
                )}
              </Fragment>
            );
          })}
        </div>
        <GqlSchemaSearch
          key={item?.type.toString()} // Force reset when changing items
          maxHeight={containerHeight}
          currentItem={item}
          schema={schema}
          setItem={(item) => setItem(item)}
          className="hidden @[10rem]:block"
        />
      </div>
      <div className="ml-auto flex gap-1 [&>*]:text-text-subtle">
        <IconButton icon="x" size="sm" title="Close documentation explorer" onClick={onClose} />
      </div>
    </nav>
  );
}

function GqlTypeInfo({
  item,
  setItem,
  schema,
}: {
  item: ExplorerItem | null;
  setItem: (t: ExplorerItem) => void;
  schema: GraphQLSchema;
}) {
  if (item == null) return null;

  const description =
    item.kind === 'type' ? getNamedType(item.type).description : item.type.description;

  const heading = (
    <div className="mb-3">
      <Heading>
        <GqlTypeLabel item={item} />
      </Heading>
      <DocMarkdown>{description || 'No description'}</DocMarkdown>
      {'deprecationReason' in item.type && item.type.deprecationReason && (
        <Banner color="notice">
          <DocMarkdown>{item.type.deprecationReason}</DocMarkdown>
        </Banner>
      )}
    </div>
  );

  if (isScalarType(item.type)) {
    return heading;
  } else if (isNonNullType(item.type) || isListType(item.type)) {
    // kinda a hack, but we'll just unwrap there and show the named type
    return (
      <GqlTypeInfo
        item={toExplorerItem(item.type.ofType, item)}
        setItem={setItem}
        schema={schema}
      />
    );
  } else if (isInterfaceType(item.type)) {
    const fields = item.type.getFields();
    const possibleTypes = schema.getPossibleTypes(item.type) ?? [];

    return (
      <div>
        {heading}

        <Subheading count={Object.keys(fields).length}>Fields</Subheading>
        {Object.keys(fields).map((fieldName) => {
          const field = fields[fieldName]!;
          const fieldItem: ExplorerItem = toExplorerItem(field, item);
          return (
            <div key={`${field.type}::${field.name}`} className="my-4">
              <GqlTypeRow
                item={fieldItem}
                setItem={setItem}
                name={{ value: fieldName, color: 'primary' }}
              />
            </div>
          );
        })}

        {possibleTypes.length > 0 && (
          <>
            <Subheading>Implemented By</Subheading>
            {possibleTypes.map((t: any) => (
              <GqlTypeRow key={t.name} item={toExplorerItem(t, item)} setItem={setItem} />
            ))}
          </>
        )}
      </div>
    );
  } else if (isUnionType(item.type)) {
    const types = item.type.getTypes();

    return (
      <div>
        {heading}

        <Subheading>Possible Types</Subheading>
        {types.map((t) => (
          <GqlTypeRow key={t.name} item={{ kind: 'type', type: t, from: item }} setItem={setItem} />
        ))}
      </div>
    );
  } else if (isEnumType(item.type)) {
    const values = item.type.getValues();

    return (
      <div>
        {heading}
        <Subheading>Values</Subheading>
        {values.map((v) => (
          <div key={v.name} className="my-4 font-mono text-editor truncate">
            <span className="text-primary">{v.value}</span>
            <DocMarkdown>{v.description ?? null}</DocMarkdown>
          </div>
        ))}
      </div>
    );
  } else if (item.kind === 'input_field') {
    return (
      <div className="flex flex-col gap-3">
        {heading}

        {item.type.defaultValue !== undefined && (
          <div>
            <Subheading>Default Value</Subheading>
            <div className="font-mono text-editor">{JSON.stringify(item.type.defaultValue)}</div>
          </div>
        )}

        <div>
          <Subheading>Type</Subheading>
          <GqlTypeRow
            className="mt-4"
            item={{ kind: 'type', type: item.type.type, from: item }}
            setItem={setItem}
          />
        </div>
      </div>
    );
  } else if (item.kind === 'field') {
    return (
      <div className="flex flex-col gap-3">
        {heading}

        <div>
          <Subheading>Type</Subheading>
          <GqlTypeRow
            className="mt-4"
            item={{ kind: 'type', type: item.type.type, from: item }}
            setItem={setItem}
          />
        </div>

        {item.type.args.length > 0 && (
          <div>
            <Subheading>Arguments</Subheading>
            {item.type.args.map((a) => {
              return (
                <div key={a.type + '::' + a.name} className="my-4">
                  <GqlTypeRow
                    name={{ value: a.name, color: 'info' }}
                    item={{ kind: 'type', type: a.type, from: item }}
                    setItem={setItem}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  } else if (isInputObjectType(item.type)) {
    const fields = item.type.getFields();
    return (
      <div>
        {heading}

        <Subheading count={Object.keys(fields).length}>Fields</Subheading>
        {Object.keys(fields).map((fieldName) => {
          const field = fields[fieldName];
          if (field == null) return null;
          const fieldItem: ExplorerItem = {
            kind: 'input_field',
            type: field,
            from: item,
          };
          return (
            <div key={`${field.type}::${field.name}`} className="my-4">
              <GqlTypeRow
                item={fieldItem}
                setItem={setItem}
                name={{ value: fieldName, color: 'primary' }}
              />
            </div>
          );
        })}
      </div>
    );
  } else if (isObjectType(item.type)) {
    const fields = item.type.getFields();
    const interfaces = item.type.getInterfaces();

    return (
      <div>
        {heading}
        {interfaces.length > 0 && (
          <>
            <Subheading>Implements</Subheading>
            {interfaces.map((i) => (
              <GqlTypeRow
                key={i.name}
                item={{ kind: 'type', type: i, from: item }}
                setItem={setItem}
              />
            ))}
          </>
        )}

        <Subheading count={Object.keys(fields).length}>Fields</Subheading>
        {Object.keys(fields).map((fieldName) => {
          const field = fields[fieldName];
          if (field == null) return null;
          const fieldItem: ExplorerItem = { kind: 'field', type: field, from: item };
          return (
            <div key={`${field.type}::${field.name}`} className="my-4">
              <GqlTypeRow
                item={fieldItem}
                setItem={setItem}
                name={{ value: fieldName, color: 'primary' }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  console.log('Unknown GraphQL Type', item);
  return <div>Unknown GraphQL type</div>;
}

function GqlTypeRow({
  item,
  setItem,
  name,
  description,
  className,
  hideDescription,
}: {
  item: ExplorerItem;
  name?: { value: string; color: Color };
  description?: string | null;
  setItem: (t: ExplorerItem) => void;
  className?: string;
  hideDescription?: boolean;
}) {
  if (item == null) return null;

  let child: ReactNode = <>Unknown Type</>;

  if (item.kind === 'type') {
    child = (
      <>
        <div className="font-mono text-editor">
          {name && (
            <span
              className={classNames(
                name?.color === 'danger' && 'text-danger',
                name?.color === 'primary' && 'text-primary',
                name?.color === 'success' && 'text-success',
                name?.color === 'warning' && 'text-warning',
                name?.color === 'notice' && 'text-notice',
                name?.color === 'info' && 'text-info',
              )}
            >
              {name.value}:&nbsp;
            </span>
          )}
          <GqlTypeLink color="notice" item={item} setItem={setItem} />
        </div>
        {!hideDescription && (
          <DocMarkdown>
            {(description === undefined ? getNamedType(item.type).description : description) ??
              null}
          </DocMarkdown>
        )}
      </>
    );
  } else if (item.kind === 'field') {
    const returnItem: ExplorerItem = {
      kind: 'type',
      type: item.type.type,
      from: item.from,
    };
    child = (
      <div>
        <div className="font-mono text-editor">
          <GqlTypeLink color="info" item={item} setItem={setItem}>
            {name?.value}
          </GqlTypeLink>
          {item.type.args.length > 0 && (
            <>
              <span className="text-text-subtle">(</span>
              {item.type.args.map((arg) => (
                <div
                  key={`${arg.type}::${arg.name}`}
                  className={classNames(item.type.args.length == 1 && 'inline-flex')}
                >
                  {item.type.args.length > 1 && <>&nbsp;&nbsp;</>}
                  <span className="text-primary">{arg.name}:</span>&nbsp;
                  <GqlTypeLink
                    color="notice"
                    item={{ kind: 'type', type: arg.type, from: item.from }}
                    setItem={setItem}
                  />
                </div>
              ))}
              <span className="text-text-subtle">)</span>
            </>
          )}
          <span className="text-text-subtle">:</span>{' '}
          <GqlTypeLink color="notice" item={returnItem} setItem={setItem} />
        </div>
        <DocMarkdown className="!text-text-subtle mt-0.5">
          {item.type.description ?? null}
        </DocMarkdown>
      </div>
    );
  } else if (item.kind === 'input_field') {
    child = (
      <>
        <div className="font-mono text-editor">
          {name && <span className="text-primary">{name.value}:</span>}{' '}
          <GqlTypeLink color="notice" item={item} setItem={setItem} />
        </div>
        <DocMarkdown>{item.type.description ?? null}</DocMarkdown>
      </>
    );
  }

  return <div className={classNames(className, 'w-full min-w-0')}>{child}</div>;
}

function GqlTypeLink({
  item,
  setItem,
  color,
  children,
  leftSlot,
  rightSlot,
  onNavigate,
  className,
  noTruncate,
}: {
  item: ExplorerItem;
  color?: Color;
  setItem: (item: ExplorerItem) => void;
  onNavigate?: () => void;
  children?: ReactNode;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  noTruncate?: boolean;
}) {
  if (item?.kind === 'type' && isListType(item.type)) {
    return (
      <span className="font-mono text-editor">
        <span className="text-text-subtle">[</span>
        <GqlTypeLink
          item={{ ...item, type: item.type.ofType }}
          setItem={setItem}
          color={color}
          leftSlot={leftSlot}
          rightSlot={rightSlot}
        >
          {children}
        </GqlTypeLink>
        <span className="text-text-subtle">]</span>
      </span>
    );
  } else if (item?.kind === 'type' && isNonNullType(item.type)) {
    return (
      <span className="font-mono text-editor">
        <GqlTypeLink
          item={{ ...item, type: item.type.ofType }}
          setItem={setItem}
          color={color}
          leftSlot={leftSlot}
          rightSlot={rightSlot}
        >
          {children}
        </GqlTypeLink>
        <span className="text-text-subtle">!</span>
      </span>
    );
  }

  return (
    <button
      className={classNames(
        className,
        'hover:underline text-left mr-auto gap-2 max-w-full',
        'inline-flex items-center',
        'font-mono text-editor',
        !noTruncate && 'truncate',
        color === 'danger' && 'text-danger',
        color === 'primary' && 'text-primary',
        color === 'success' && 'text-success',
        color === 'warning' && 'text-warning',
        color === 'notice' && 'text-notice',
        color === 'info' && 'text-info',
      )}
      onClick={() => {
        setItem(item);
        onNavigate?.();
      }}
    >
      {leftSlot}
      <GqlTypeLabel item={item} noTruncate={noTruncate}>
        {children}
      </GqlTypeLabel>
      {rightSlot}
    </button>
  );
}

function GqlTypeLabel({
  item,
  children,
  className,
  noTruncate,
}: {
  item: ExplorerItem;
  children?: ReactNode;
  className?: string;
  noTruncate?: boolean;
}) {
  let inner;
  if (children) {
    inner = children;
  } else if (item == null) {
    inner = 'Root';
  } else if (item.kind === 'field') {
    inner = item.type.name + (item.type.args.length > 0 ? '(…)' : '');
  } else if ('name' in item.type) {
    inner = item.type.name;
  } else {
    console.error('Unknown item type', item);
    inner = 'UNKNOWN';
  }

  return <span className={classNames(className, !noTruncate && 'truncate')}>{inner}</span>;
}

function Subheading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="font-bold text-lg mt-6 flex items-center">
      <div className="truncate min-w-0">{children}</div>
      {count && <CountBadge count={count} />}
    </h2>
  );
}

interface SearchResult {
  name: string;
  type: GraphQLNamedType | GraphQLField<any, any> | GraphQLInputField;
  score: number;
  from: GraphQLNamedType | null;
  depth: string[];
}

function GqlSchemaSearch({
  schema,
  currentItem,
  setItem,
  className,
  maxHeight,
}: {
  currentItem: ExplorerItem | null;
  schema: GraphQLSchema;
  setItem: (t: ExplorerItem) => void;
  className?: string;
  maxHeight: number;
}) {
  const [activeResult, setActiveResult] = useStateWithDeps<SearchResult | null>(null, [
    currentItem,
  ]);
  const [focused, setOpen] = useState<boolean>(false);
  const [value, setValue] = useState<string>('');
  const debouncedValue = useDebouncedValue(value, 300);
  const menuRef = useRef<HTMLDivElement>(null);
  const canSearch =
    currentItem == null ||
    (isNamedType(currentItem.type) &&
      !isEnumType(currentItem.type) &&
      !isScalarType(currentItem.type));

  const results = useMemo(() => {
    const results: SearchResult[] = [];
    walkTypeGraph(schema, currentItem?.type ?? null, (type, from, depth) => {
      if (type === currentItem?.type) {
        return true; // Skip the current type and continue
      }

      const match = fuzzyMatch(type.name, debouncedValue);
      if (match == null) {
        // Do nothing
      } else {
        results.push({ name: type.name, type, score: match.score, from, depth });
      }
      return true;
    });
    results.sort((a, b) => {
      if (value == '') {
        if (a.name.startsWith('_') && !b.name.startsWith('_')) {
          // Always sort __<NAME> types to the end when there is no query
          return 1;
        } else if (a.depth.length !== b.depth.length) {
          return a.depth.length - b.depth.length;
        } else {
          return a.name.localeCompare(b.name);
        }
      } else {
        if (a.depth.length !== b.depth.length) {
          return a.depth.length - b.depth.length;
        } else if (a.score === 0 && b.score === 0) {
          return a.name.localeCompare(b.name);
        } else if (a.score === b.score && a.name.length === b.name.length) {
          return a.name.localeCompare(b.name);
        } else if (a.score === b.score) {
          return a.name.length - b.type.name.length;
        } else {
          return b.score - a.score;
        }
      }
    });
    return results.slice(0, 100);
  }, [currentItem, schema, debouncedValue, value]);

  const activeIndex = useMemo(() => {
    const index = results.findIndex((r) => r === activeResult) ?? 0;
    return index === -1 ? 0 : index;
  }, [activeResult, results]);

  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(menuRef, () => setOpen(false));

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault();
        const next = results[activeIndex + 1] ?? results[results.length - 1] ?? null;
        setActiveResult(next);
      } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault();
        const prev = results[activeIndex - 1] ?? results[0] ?? null;
        setActiveResult(prev);
      } else if (e.key === 'Escape') {
        inputRef.current?.blur();
      } else if (e.key === 'Enter') {
        const result = activeResult ?? results[0] ?? null;
        if (result) {
          setItem(toExplorerItem(result?.type, currentItem));
          inputRef.current?.blur();
        }
      }
    },
    [results, activeIndex, setActiveResult, activeResult, setItem, currentItem],
  );

  if (!canSearch) return <span />;

  return (
    <div
      className={classNames(
        className,
        'relative flex items-center bg-surface z-20 min-w-0',
        !focused && 'max-w-[6rem] ml-auto',
        focused && '!absolute top-0 left-1.5 right-1.5 bottom-0 pt-1.5',
      )}
    >
      <PlainInput
        ref={inputRef}
        size="sm"
        label="search"
        hideLabel
        defaultValue={value}
        placeholder={focused ? 'Search ' + (currentItem?.type.toString() ?? 'Schema') : 'Search'}
        leftSlot={
          <div className="w-10 flex justify-center items-center">
            <Icon size="sm" icon="search" color="secondary" />
          </div>
        }
        onChange={setValue}
        onKeyDownCapture={handleKeyDown}
        onFocus={() => {
          setOpen(true);
        }}
      />
      <div
        ref={menuRef}
        style={{ maxHeight: maxHeight - 60 }}
        className={classNames(
          'x-theme-menu absolute z-10 mt-0.5 p-1.5 top-full right-0 bg-surface',
          'border border-border rounded-lg overflow-y-auto w-full shadow-lg',
          !focused && 'hidden',
        )}
      >
        {results.length === 0 && (
          <SearchResult isActive={false} className="text-text-subtle">
            No results found
          </SearchResult>
        )}
        {results.map((r, i) => {
          const item = toExplorerItem(r.type, currentItem);
          if (item == currentItem) return null;
          return (
            <SearchResult
              key={`${i}::${r.type.name}`}
              onMouseDown={() => {
                setItem(item);
                setOpen(false);
              }}
              onMouseEnter={() => setActiveResult(r)}
              isActive={i === activeIndex}
            >
              {r.from !== currentItem?.type && r.from != null && (
                <>
                  <GqlTypeLabel
                    item={toExplorerItem(r.from, currentItem)}
                    className="text-text-subtle"
                  />
                  .
                </>
              )}
              <GqlTypeLabel item={item} className="text-text" />
            </SearchResult>
          );
        })}
      </div>
    </div>
  );
}

function SearchResult({
  isActive,
  className,
  ...extraProps
}: {
  isActive: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLButtonElement>) {
  const initRef = useCallback(
    (el: HTMLButtonElement | null) => {
      if (el === null) return;
      if (isActive) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    },
    [isActive],
  );
  return (
    <button
      ref={initRef}
      className={classNames(
        className,
        'px-3 truncate w-full text-left h-sm rounded text-editor font-mono',
        isActive && 'bg-surface-highlight',
      )}
      {...extraProps}
    />
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="font-bold text-2xl truncate">{children}</h1>;
}

function DocMarkdown({ children, className }: { children: string | null; className?: string }) {
  return (
    <Markdown className={classNames(className, '!text-text-subtle italic')}>{children}</Markdown>
  );
}

function walkTypeGraph(
  schema: GraphQLSchema,
  start: GraphQLType | GraphQLField<any, any> | GraphQLInputField | null,
  cb: (
    type: GraphQLNamedType | GraphQLField<any, any> | GraphQLInputField,
    from: GraphQLNamedType | null,
    path: string[],
  ) => boolean,
) {
  const visited = new Set<string>();
  const queue: Array<{
    current: GraphQLType | GraphQLField<any, any> | GraphQLInputField;
    from: GraphQLNamedType | null;
    path: string[];
  }> = [];

  const initial = start
    ? [start]
    : [
        ...Object.values(schema.getTypeMap()),
        schema.getQueryType(),
        schema.getMutationType(),
        schema.getSubscriptionType(),
      ].filter((t) => t != null);

  for (const type of initial) {
    queue.push({ current: type, from: null, path: [] });
  }

  while (queue.length > 0) {
    const { current, from, path } = queue.shift()!;
    if (!isNamedType(current)) continue;

    const name = current.name;
    if (visited.has(name)) continue;
    visited.add(name);

    const cont = cb(current, from, path);
    if (!cont) break;

    if (isObjectType(current) || isInterfaceType(current)) {
      for (const field of Object.values(current.getFields())) {
        cb(field, current, [...path, current.name]);

        const fieldType = getNamedType(field.type);
        const next = schema.getType(fieldType.name);
        if (next && !visited.has(fieldType.name)) {
          queue.push({
            current: next,
            from: current,
            path: [...path, current.name, field.name],
          });
        }
      }
    } else if (isInputObjectType(current)) {
      for (const inputField of Object.values(current.getFields())) {
        cb(inputField, current, [...path, current.name]);

        const fieldType = getNamedType(inputField.type);
        const next = schema.getType(fieldType.name);
        if (next && !visited.has(fieldType.name)) {
          queue.push({
            current: next,
            from: current,
            path: [...path, current.name, inputField.name],
          });
        }
      }
    } else if (isUnionType(current)) {
      for (const subtype of current.getTypes()) {
        if (!visited.has(subtype.name)) {
          queue.push({
            current: subtype,
            from: current,
            path: [...path, current.name, subtype.name],
          });
        }
      }
    }
  }
}

function toExplorerItem(t: any, from: ExplorerItem | null): ExplorerItem | null {
  if (t == null) return null;

  // GraphQLField-like: has `args` (array) and `type`
  if (typeof t === 'object' && Array.isArray(t.args) && t.type) {
    return { kind: 'field', type: t, from };
  }

  // GraphQLInputField-like: has `type`, no `args`, maybe `defaultValue`, and no `resolve`
  if (
    typeof t === 'object' &&
    t.type &&
    !('args' in t) &&
    !('resolve' in t) &&
    ('defaultValue' in t || 'description' in t)
  ) {
    return { kind: 'input_field', type: t, from };
  }

  // Fallback: treat as GraphQLNamedType (object, scalar, enum, etc.)
  return { kind: 'type', type: t, from };
}
