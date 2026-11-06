import type { EditorView } from "@codemirror/view";
import { generateId } from "@yaakapp-internal/lib/generateId";
import type { Color } from "@yaakapp-internal/plugins";
import classNames from "classnames";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStateWithDeps } from "../hooks/useStateWithDeps";
import type { CodeEditorProps } from "./editor/CodeEditor";
import { LazyCodeEditor } from "./editor/LazyCodeEditor";
import { IconButton } from "./IconButton";
import { Label } from "./Label";
import { HStack } from "./Stacks";

export type InputProps = Pick<
  CodeEditorProps,
  | "language"
  | "forceUpdateKey"
  | "disabled"
  | "autoFocus"
  | "autoSelect"
  | "extensions"
  | "onKeyDown"
  | "readOnly"
> & {
  className?: string;
  containerClassName?: string;
  inputWrapperClassName?: string;
  defaultValue?: string | null;
  disableObscureToggle?: boolean;
  fullHeight?: boolean;
  hideLabel?: boolean;
  help?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
  labelPosition?: "top" | "left";
  leftSlot?: ReactNode;
  multiLine?: boolean;
  name?: string;
  onBlur?: () => void;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onPaste?: (value: string) => void;
  onPasteOverwrite?: CodeEditorProps["onPasteOverwrite"];
  placeholder?: string;
  /** Renders the editor, for a host whose editor builds on CodeEditor */
  renderEditor?: (props: CodeEditorProps) => ReactNode;
  /** Rendered beside the right slot, given a way to replace the whole value */
  renderOptionsPicker?: (insert: (value: string) => void) => ReactNode;
  required?: boolean;
  rightSlot?: ReactNode;
  size?: "2xs" | "xs" | "sm" | "md" | "auto";
  stateKey: CodeEditorProps["stateKey"];
  tint?: Color;
  type?: "text" | "password";
  validate?: boolean | ((v: string) => boolean);
  wrapLines?: boolean;
  setRef?: (h: InputHandle | null) => void;
};

export interface InputHandle {
  focus: () => void;
  isFocused: () => boolean;
  value: () => string;
  selectAll: () => void;
  dispatch: EditorView["dispatch"];
}

function renderCodeEditor(props: CodeEditorProps) {
  return <LazyCodeEditor {...props} />;
}

export function Input({
  className,
  containerClassName,
  defaultValue,
  disableObscureToggle,
  disabled,
  forceUpdateKey,
  fullHeight,
  help,
  hideLabel,
  inputWrapperClassName,
  label,
  labelClassName,
  labelPosition = "top",
  leftSlot,
  multiLine,
  onBlur,
  onChange,
  onFocus,
  onPaste,
  onPasteOverwrite,
  placeholder,
  readOnly,
  required,
  renderEditor,
  renderOptionsPicker,
  rightSlot,
  size = "md",
  stateKey,
  tint,
  type = "text",
  validate,
  wrapLines,
  setRef,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [obscured, setObscured] = useStateWithDeps(type === "password", [type]);
  const [hasChanged, setHasChanged] = useStateWithDeps<boolean>(false, [forceUpdateKey]);
  const editorRef = useRef<EditorView | null>(null);
  const skipNextFocus = useRef<boolean>(false);

  const handle = useMemo<InputHandle>(
    () => ({
      focus: () => {
        if (editorRef.current == null) return;
        const anchor = editorRef.current.state.doc.length;
        skipNextFocus.current = true;
        editorRef.current.focus();
        editorRef.current.dispatch({ selection: { anchor, head: anchor }, scrollIntoView: true });
      },
      isFocused: () => editorRef.current?.hasFocus ?? false,
      value: () => editorRef.current?.state.doc.toString() ?? "",
      dispatch: (...args) => {
        // oxlint-disable-next-line no-explicit-any
        editorRef.current?.dispatch(...(args as any));
      },
      selectAll() {
        if (editorRef.current == null) return;
        editorRef.current.focus();
        editorRef.current.dispatch({
          selection: { anchor: 0, head: editorRef.current.state.doc.length },
        });
      },
    }),
    [],
  );

  // Replace the whole value with a picked option. Dispatching runs it through the editor's
  // onChange, same as typing, so callers see one consistent change path.
  const insertOption = useCallback((value: string) => {
    const view = editorRef.current;
    if (view == null) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    view.focus();
  }, []);

  const setEditorRef = useCallback(
    (h: EditorView | null) => {
      editorRef.current = h;
      setRef?.(handle);
    },
    [handle, setRef],
  );

  useEffect(() => {
    const fn = () => {
      skipNextFocus.current = true;
    };
    window.addEventListener("focus", fn);
    return () => {
      window.removeEventListener("focus", fn);
    };
  }, []);

  const handleFocus = useCallback(() => {
    if (readOnly) return;

    if (!skipNextFocus.current) {
      editorRef.current?.dispatch({
        selection: { anchor: 0, head: editorRef.current.state.doc.length },
      });
    }

    setFocused(true);
    onFocus?.();
    skipNextFocus.current = false;
  }, [onFocus, readOnly]);

  const handleBlur = useCallback(async () => {
    setFocused(false);
    // Move selection to the end on blur
    const anchor = editorRef.current?.state.doc.length ?? 0;
    editorRef.current?.dispatch({
      selection: { anchor, head: anchor },
    });
    onBlur?.();
  }, [onBlur]);

  const id = useRef(`input-${generateId()}`);
  const editorClassName = classNames(
    className,
    "bg-transparent! min-w-0 h-auto w-full focus:outline-hidden placeholder:text-placeholder",
  );

  const isValid = useMemo(() => {
    if (required && !validateRequire(defaultValue ?? "")) return false;
    if (typeof validate === "boolean") return validate;
    if (typeof validate === "function" && !validate(defaultValue ?? "")) return false;
    return true;
  }, [required, defaultValue, validate]);

  const handleChange = useCallback(
    (value: string) => {
      onChange?.(value);
      setHasChanged(true);
    },
    [onChange, setHasChanged],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Submit the nearest form on Enter key press
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;

      const form = wrapperRef.current?.closest("form");
      if (!isValid || form == null) return;

      form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    },
    [isValid],
  );

  return (
    <div
      ref={wrapperRef}
      className={classNames(
        "pointer-events-auto", // Just in case we're placing in disabled parent
        "w-full",
        fullHeight && "h-full",
        labelPosition === "left" && "flex items-center gap-2",
        labelPosition === "top" && "flex-row gap-0.5",
      )}
    >
      <Label
        htmlFor={id.current}
        help={help}
        required={required}
        visuallyHidden={hideLabel}
        className={classNames(labelClassName)}
      >
        {label}
      </Label>
      <HStack
        alignItems="stretch"
        className={classNames(
          containerClassName,
          fullHeight && "h-full",
          "x-theme-input",
          "relative w-full rounded-md text overflow-hidden",
          "border",
          focused && !disabled ? "border-border-focus" : "border-border",
          disabled && "border-dotted",
          !isValid && hasChanged && "border-danger!",
          size === "md" && "min-h-md",
          size === "sm" && "min-h-sm",
          size === "xs" && "min-h-xs",
          size === "2xs" && "min-h-2xs",
        )}
      >
        {tint != null && (
          <div
            aria-hidden
            className={classNames(
              "absolute inset-0 opacity-5 pointer-events-none",
              tint === "primary" && "bg-primary",
              tint === "secondary" && "bg-secondary",
              tint === "info" && "bg-info",
              tint === "success" && "bg-success",
              tint === "notice" && "bg-notice",
              tint === "warning" && "bg-warning",
              tint === "danger" && "bg-danger",
            )}
          />
        )}
        {leftSlot}
        <HStack
          className={classNames(
            inputWrapperClassName,
            "flex-1 min-w-0 px-2",
            fullHeight && "h-full",
            leftSlot ? "pl-0" : null,
            rightSlot ? "pr-0" : null,
          )}
        >
          {(renderEditor ?? renderCodeEditor)({
            setRef: setEditorRef,
            id: id.current,
            hideGutter: true,
            singleLine: !multiLine,
            containerOnly: true,
            stateKey,
            wrapLines,
            heightMode: "auto",
            onKeyDown: handleKeyDown,
            type: type === "password" && !obscured ? "text" : type,
            defaultValue,
            forceUpdateKey,
            placeholder,
            onChange: handleChange,
            onPaste,
            onPasteOverwrite,
            disabled,
            className: classNames(
              editorClassName,
              multiLine && size === "md" && "py-1.5",
              multiLine && size === "sm" && "py-1",
              multiLine && (size === "xs" || size === "2xs") && "py-0.5",
            ),
            onFocus: handleFocus,
            onBlur: handleBlur,
            readOnly,
            ...props,
          })}
        </HStack>
        {type === "password" && !disableObscureToggle && (
          <IconButton
            title={
              obscured
                ? `Show ${typeof label === "string" ? label : "field"}`
                : `Obscure ${typeof label === "string" ? label : "field"}`
            }
            size="xs"
            className={classNames("mr-0.5 h-auto! my-0.5", disabled && "opacity-disabled")}
            color={tint}
            // iconClassName={classNames(
            //   tint === 'primary' && 'text-primary',
            //   tint === 'secondary' && 'text-secondary',
            //   tint === 'info' && 'text-info',
            //   tint === 'success' && 'text-success',
            //   tint === 'notice' && 'text-notice',
            //   tint === 'warning' && 'text-warning',
            //   tint === 'danger' && 'text-danger',
            // )}
            iconSize="sm"
            icon={obscured ? "eye" : "eye_closed"}
            onClick={() => setObscured((o) => !o)}
          />
        )}
        {renderOptionsPicker?.(insertOption)}
        {rightSlot}
      </HStack>
    </div>
  );
}

function validateRequire(v: string) {
  return v.length > 0;
}
