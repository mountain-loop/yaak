import { defaultKeymap } from '@codemirror/commands';
import { forceParsing } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { keymap, placeholder as placeholderExt, tooltips } from '@codemirror/view';
import type { EnvironmentVariable } from '@yaakapp-internal/models';
import type { TemplateFunction } from '@yaakapp-internal/plugin';
import classNames from 'classnames';
import { EditorView } from 'codemirror';
import type { MutableRefObject, ReactNode } from 'react';
import {
  useEffect,
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { useActiveEnvironmentVariables } from '../../../hooks/useActiveEnvironmentVariables';
import { parseTemplate } from '../../../hooks/useParseTemplate';
import { useRequestEditor } from '../../../hooks/useRequestEditor';
import { useSettings } from '../../../hooks/useSettings';
import { useTemplateFunctions } from '../../../hooks/useTemplateFunctions';
import { useDialog } from '../../DialogContext';
import { TemplateFunctionDialog } from '../../TemplateFunctionDialog';
import { TemplateVariableDialog } from '../../TemplateVariableDialog';
import { IconButton } from '../IconButton';
import { HStack } from '../Stacks';
import './Editor.css';
import { baseExtensions, getLanguageExtension, multiLineExtensions } from './extensions';
import type { GenericCompletionConfig } from './genericCompletion';
import { singleLineExt } from './singleLine';

// Export some things so all the code-split parts are in this file
export { buildClientSchema, getIntrospectionQuery } from 'graphql/utilities';
export { graphql } from 'cm6-graphql';
export { formatSdl } from 'format-graphql';

export interface EditorProps {
  id?: string;
  readOnly?: boolean;
  disabled?: boolean;
  type?: 'text' | 'password';
  className?: string;
  heightMode?: 'auto' | 'full';
  language?: 'javascript' | 'json' | 'html' | 'xml' | 'graphql' | 'url' | 'pairs' | 'text';
  forceUpdateKey?: string | number;
  autoFocus?: boolean;
  autoSelect?: boolean;
  defaultValue?: string | null;
  placeholder?: string;
  tooltipContainer?: HTMLElement;
  useTemplating?: boolean;
  onChange?: (value: string) => void;
  onPaste?: (value: string) => void;
  onPasteOverwrite?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  singleLine?: boolean;
  wrapLines?: boolean;
  format?: (v: string) => Promise<string>;
  autocomplete?: GenericCompletionConfig;
  autocompleteVariables?: boolean;
  extraExtensions?: Extension[];
  actions?: ReactNode;
}

const emptyVariables: EnvironmentVariable[] = [];

export const Editor = forwardRef<EditorView | undefined, EditorProps>(function Editor(
  {
    readOnly,
    type = 'text',
    heightMode,
    language = 'text',
    autoFocus,
    autoSelect,
    placeholder,
    useTemplating,
    defaultValue,
    forceUpdateKey,
    onChange,
    onPaste,
    onPasteOverwrite,
    onFocus,
    onBlur,
    onKeyDown,
    className,
    singleLine,
    format,
    autocomplete,
    extraExtensions,
    autocompleteVariables,
    actions,
    wrapLines,
  }: EditorProps,
  ref,
) {
  const settings = useSettings();
  const templateFunctions = useTemplateFunctions();
  const allEnvironmentVariables = useActiveEnvironmentVariables();
  const environmentVariables = autocompleteVariables ? allEnvironmentVariables : emptyVariables;

  if (settings && wrapLines === undefined) {
    wrapLines = settings.editorSoftWrap;
  }

  const cm = useRef<{ view: EditorView; languageCompartment: Compartment } | null>(null);
  useImperativeHandle(ref, () => cm.current?.view);

  // Use ref so we can update the handler without re-initializing the editor
  const handleChange = useRef<EditorProps['onChange']>(onChange);
  useEffect(() => {
    handleChange.current = onChange ? onChange : onChange;
  }, [onChange]);

  // Use ref so we can update the handler without re-initializing the editor
  const handlePaste = useRef<EditorProps['onPaste']>(onPaste);
  useEffect(() => {
    handlePaste.current = onPaste;
  }, [onPaste]);

  // Use ref so we can update the handler without re-initializing the editor
  const handlePasteOverwrite = useRef<EditorProps['onPasteOverwrite']>(onPaste);
  useEffect(() => {
    handlePasteOverwrite.current = onPasteOverwrite;
  }, [onPasteOverwrite]);

  // Use ref so we can update the handler without re-initializing the editor
  const handleFocus = useRef<EditorProps['onFocus']>(onFocus);
  useEffect(() => {
    handleFocus.current = onFocus;
  }, [onFocus]);

  // Use ref so we can update the handler without re-initializing the editor
  const handleBlur = useRef<EditorProps['onBlur']>(onBlur);
  useEffect(() => {
    handleBlur.current = onBlur;
  }, [onBlur]);

  // Use ref so we can update the handler without re-initializing the editor
  const handleKeyDown = useRef<EditorProps['onKeyDown']>(onKeyDown);
  useEffect(() => {
    handleKeyDown.current = onKeyDown;
  }, [onKeyDown]);

  // Update placeholder
  const placeholderCompartment = useRef(new Compartment());
  useEffect(() => {
    if (cm.current === null) return;
    const effect = placeholderCompartment.current.reconfigure(
      placeholderExt(placeholderElFromText(placeholder ?? '')),
    );
    cm.current?.view.dispatch({ effects: effect });
  }, [placeholder]);

  // Update wrap lines
  const wrapLinesCompartment = useRef(new Compartment());
  useEffect(() => {
    if (cm.current === null) return;
    const ext = wrapLines ? [EditorView.lineWrapping] : [];
    const effect = wrapLinesCompartment.current.reconfigure(ext);
    cm.current?.view.dispatch({ effects: effect });
  }, [wrapLines]);

  const dialog = useDialog();
  const onClickFunction = useCallback(
    async (fn: TemplateFunction, tagValue: string, startPos: number) => {
      const initialTokens = await parseTemplate(tagValue);
      dialog.show({
        id: 'template-function',
        size: 'sm',
        title: 'Configure Function',
        description: fn.description,
        render: ({ hide }) => (
          <TemplateFunctionDialog
            templateFunction={fn}
            hide={hide}
            initialTokens={initialTokens}
            onChange={(insert) => {
              cm.current?.view.dispatch({
                changes: [{ from: startPos, to: startPos + tagValue.length, insert }],
              });
            }}
          />
        ),
      });
    },
    [dialog],
  );

  const onClickVariable = useCallback(
    async (_v: EnvironmentVariable, tagValue: string, startPos: number) => {
      const initialTokens = await parseTemplate(tagValue);
      dialog.show({
        size: 'dynamic',
        id: 'template-variable',
        title: 'Change Variable',
        render: ({ hide }) => (
          <TemplateVariableDialog
            hide={hide}
            initialTokens={initialTokens}
            onChange={(insert) => {
              cm.current?.view.dispatch({
                changes: [{ from: startPos, to: startPos + tagValue.length, insert }],
              });
            }}
          />
        ),
      });
    },
    [dialog],
  );

  const onClickMissingVariable = useCallback(
    async (_name: string, tagValue: string, startPos: number) => {
      const initialTokens = await parseTemplate(tagValue);
      dialog.show({
        size: 'dynamic',
        id: 'template-variable',
        title: 'Configure Variable',
        render: ({ hide }) => (
          <TemplateVariableDialog
            hide={hide}
            initialTokens={initialTokens}
            onChange={(insert) => {
              cm.current?.view.dispatch({
                changes: [{ from: startPos, to: startPos + tagValue.length, insert }],
              });
            }}
          />
        ),
      });
    },
    [dialog],
  );

  const [, { focusParamValue }] = useRequestEditor();
  const onClickPathParameter = useCallback(
    async (name: string) => {
      focusParamValue(name);
    },
    [focusParamValue],
  );

  // Update the language extension when the language changes
  useEffect(() => {
    if (cm.current === null) return;
    const { view, languageCompartment } = cm.current;
    const ext = getLanguageExtension({
      language,
      environmentVariables,
      useTemplating,
      autocomplete,
      templateFunctions,
      onClickFunction,
      onClickVariable,
      onClickMissingVariable,
      onClickPathParameter,
    });
    view.dispatch({ effects: languageCompartment.reconfigure(ext) });
  }, [
    language,
    autocomplete,
    useTemplating,
    environmentVariables,
    templateFunctions,
    onClickFunction,
    onClickVariable,
    onClickMissingVariable,
    onClickPathParameter,
  ]);

  // Initialize the editor when ref mounts
  const initEditorRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (container === null) {
        cm.current?.view.destroy();
        cm.current = null;
        return;
      }

      let view: EditorView;
      try {
        const languageCompartment = new Compartment();
        const langExt = getLanguageExtension({
          language,
          useTemplating,
          autocomplete,
          environmentVariables,
          templateFunctions,
          onClickVariable,
          onClickFunction,
          onClickMissingVariable,
          onClickPathParameter,
        });

        const state = EditorState.create({
          doc: `${defaultValue ?? ''}`,
          extensions: [
            languageCompartment.of(langExt),
            placeholderCompartment.current.of(
              placeholderExt(placeholderElFromText(placeholder ?? '')),
            ),
            wrapLinesCompartment.current.of(wrapLines ? [EditorView.lineWrapping] : []),
            ...getExtensions({
              container,
              readOnly,
              singleLine,
              onChange: handleChange,
              onPaste: handlePaste,
              onPasteOverwrite: handlePasteOverwrite,
              onFocus: handleFocus,
              onBlur: handleBlur,
              onKeyDown: handleKeyDown,
            }),
            ...(extraExtensions ?? []),
          ],
        });

        view = new EditorView({ state, parent: container });

        // For large documents, the parser may parse the max number of lines and fail to add
        // things like fold markers because of it.
        // This forces it to parse more but keeps the timeout to the default of 100ms.
        forceParsing(view, 9e6, 100);

        cm.current = { view, languageCompartment };
        if (autoFocus) {
          view.focus();
        }
        if (autoSelect) {
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        }
      } catch (e) {
        console.log('Failed to initialize Codemirror', e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forceUpdateKey],
  );

  // For read-only mode, update content when `defaultValue` changes
  useEffect(() => {
    if (!readOnly || cm.current?.view == null || defaultValue == null) return;

    // Replace codemirror contents
    const currentDoc = cm.current.view.state.doc.toString();
    if (defaultValue.startsWith(currentDoc)) {
      // If we're just appending, append only the changes. This preserves
      // things like scroll position.
      cm.current.view.dispatch({
        changes: cm.current.view.state.changes({
          from: currentDoc.length,
          insert: defaultValue.slice(currentDoc.length),
        }),
      });
    } else {
      // If we're replacing everything, reset the entire content
      cm.current.view.dispatch({
        changes: cm.current.view.state.changes({
          from: 0,
          to: currentDoc.length,
          insert: defaultValue,
        }),
      });
    }
  }, [defaultValue, readOnly]);

  // Add bg classes to actions, so they appear over the text
  const decoratedActions = useMemo(() => {
    const results = [];
    const actionClassName = classNames(
      'bg-surface transition-opacity opacity-0 group-hover:opacity-100 hover:!opacity-100 shadow',
    );

    if (format) {
      results.push(
        <IconButton
          showConfirm
          key="format"
          size="sm"
          title="Reformat contents"
          icon="magic_wand"
          variant="border"
          className={classNames(actionClassName)}
          onClick={async () => {
            if (cm.current === null) return;
            const { doc } = cm.current.view.state;
            const formatted = await format(doc.toString());
            // Update editor and blur because the cursor will reset anyway
            cm.current.view.dispatch({
              changes: { from: 0, to: doc.length, insert: formatted },
            });
            cm.current.view.contentDOM.blur();
            // Fire change event
            onChange?.(formatted);
          }}
        />,
      );
    }
    results.push(
      Children.map(actions, (existingChild) => {
        if (!isValidElement(existingChild)) return null;
        return cloneElement(existingChild, {
          ...existingChild.props,
          className: classNames(existingChild.props.className, actionClassName),
        });
      }),
    );
    return results;
  }, [actions, format, onChange]);

  const cmContainer = (
    <div
      ref={initEditorRef}
      className={classNames(
        className,
        'cm-wrapper text-base',
        type === 'password' && 'cm-obscure-text',
        heightMode === 'auto' ? 'cm-auto-height' : 'cm-full-height',
        singleLine ? 'cm-singleline' : 'cm-multiline',
        readOnly && 'cm-readonly',
      )}
    />
  );

  if (singleLine) {
    return cmContainer;
  }

  return (
    <div className="group relative h-full w-full x-theme-editor bg-surface">
      {cmContainer}
      {decoratedActions && (
        <HStack
          space={1}
          justifyContent="end"
          className={classNames(
            'absolute bottom-2 left-0 right-0',
            'pointer-events-none', // No pointer events, so we don't block the editor
          )}
        >
          {decoratedActions}
        </HStack>
      )}
    </div>
  );
});

function getExtensions({
  container,
  readOnly,
  singleLine,
  onChange,
  onPaste,
  onPasteOverwrite,
  onFocus,
  onBlur,
  onKeyDown,
}: Pick<EditorProps, 'singleLine' | 'readOnly'> & {
  container: HTMLDivElement | null;
  onChange: MutableRefObject<EditorProps['onChange']>;
  onPaste: MutableRefObject<EditorProps['onPaste']>;
  onPasteOverwrite: MutableRefObject<EditorProps['onPasteOverwrite']>;
  onFocus: MutableRefObject<EditorProps['onFocus']>;
  onBlur: MutableRefObject<EditorProps['onBlur']>;
  onKeyDown: MutableRefObject<EditorProps['onKeyDown']>;
}) {
  // TODO: Ensure tooltips render inside the dialog if we are in one.
  const parent =
    container?.closest<HTMLDivElement>('[role="dialog"]') ??
    document.querySelector<HTMLDivElement>('#cm-portal') ??
    undefined;

  return [
    ...baseExtensions, // Must be first
    EditorView.domEventHandlers({
      focus: () => {
        onFocus.current?.();
      },
      blur: () => {
        onBlur.current?.();
      },
      keydown: (e) => {
        onKeyDown.current?.(e);
      },
      paste: (e, v) => {
        const textData = e.clipboardData?.getData('text/plain') ?? '';
        onPaste.current?.(textData);
        if (v.state.selection.main.from === 0 && v.state.selection.main.to === v.state.doc.length) {
          onPasteOverwrite.current?.(textData);
        }
      },
    }),
    tooltips({ parent }),
    keymap.of(singleLine ? defaultKeymap.filter((k) => k.key !== 'Enter') : defaultKeymap),
    ...(singleLine ? [singleLineExt()] : []),
    ...(!singleLine ? [multiLineExtensions] : []),
    ...(readOnly
      ? [EditorState.readOnly.of(true), EditorView.contentAttributes.of({ tabindex: '-1' })]
      : []),

    // ------------------------ //
    // Things that must be last //
    // ------------------------ //

    EditorView.updateListener.of((update) => {
      if (onChange && update.docChanged) {
        onChange.current?.(update.state.doc.toString());
      }
    }),
  ];
}

const placeholderElFromText = (text: string) => {
  const el = document.createElement('div');
  el.innerHTML = text.replaceAll('\n', '<br/>');
  return el;
};
