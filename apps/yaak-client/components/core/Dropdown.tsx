import { HStack, Icon, type IconProps, LoadingIcon, Overlay, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { atom } from "jotai";
import * as m from "motion/react-m";
import type {
  CSSProperties,
  HTMLAttributes,
  MouseEvent,
  ReactElement,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import {
  Children,
  cloneElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useKey, useWindowSize } from "react-use";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { HotkeyAction } from "../../hooks/useHotKey";
import { useHotKey } from "../../hooks/useHotKey";
import { useStateWithDeps } from "../../hooks/useStateWithDeps";
import { generateId } from "../../lib/generateId";
import { getNodeText } from "../../lib/getNodeText";
import { jotaiStore } from "../../lib/jotai";
import { fireAndForget } from "../../lib/fireAndForget";
import { ErrorBoundary } from "../ErrorBoundary";
import { Button } from "./Button";
import { Hotkey } from "./Hotkey";
import { IconButton } from "./IconButton";
import type { SeparatorAction } from "./Separator";
import { Separator } from "./Separator";

export type DropdownItemSeparator = {
  type: "separator";
  label?: ReactNode;
  hidden?: boolean;
  /** A control shown beside the label, eg. revealing the labelled file on disk. */
  action?: SeparatorAction;
};

export type DropdownItemContent = {
  type: "content";
  label?: ReactNode;
  hidden?: boolean;
};

export type DropdownItemDefault = {
  type?: "default";
  label: ReactNode;
  hotKeyAction?: HotkeyAction;
  hotKeyLabelOnly?: boolean;
  color?: "default" | "primary" | "danger" | "info" | "warning" | "notice" | "success";
  disabled?: boolean;
  hidden?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  waitForOnSelect?: boolean;
  keepOpenOnSelect?: boolean;
  onSelect?: () => void | Promise<void>;
  submenu?: DropdownItem[];
  /** If true, submenu opens on click instead of hover */
  submenuOpenOnClick?: boolean;
  /**
   * How the submenu opens. "row" (default) opens it from the row itself (hover, or click
   * with submenuOpenOnClick). "button" keeps the row selectable via onSelect and renders
   * a dedicated button on the right that opens the submenu.
   */
  submenuTrigger?: "row" | "button";
  icon?: IconProps["icon"];
};

export type DropdownItem = DropdownItemDefault | DropdownItemSeparator | DropdownItemContent;

export interface DropdownProps {
  children: ReactElement<HTMLAttributes<HTMLButtonElement>>;
  items: DropdownItem[];
  fullWidth?: boolean;
  hotKeyAction?: HotkeyAction;
  onOpen?: () => void;
}

export interface DropdownRef {
  isOpen: boolean;
  open: (index?: number) => void;
  toggle: () => void;
  close?: () => void;
  next?: (incrBy?: number) => void;
  prev?: (incrBy?: number) => void;
  select?: () => void;
}

// Every dropdown gets a unique ID and we use this global atom to ensure
// only one dropdown can be open at a time.
// TODO: Also make ContextMenu use this
const openAtom = atom<string | null>(null);

export const Dropdown = forwardRef<DropdownRef, DropdownProps>(function Dropdown(
  { children, items, hotKeyAction, fullWidth, onOpen }: DropdownProps,
  ref,
) {
  const id = useRef(generateId());
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    return jotaiStore.sub(openAtom, () => {
      const globalOpenId = jotaiStore.get(openAtom);
      const newIsOpen = globalOpenId === id.current;
      if (newIsOpen !== isOpen) {
        setIsOpen(newIsOpen);
      }
    });
  }, [isOpen]);

  // const [isOpen, _setIsOpen] = useState<boolean>(false);
  const [defaultSelectedIndex, setDefaultSelectedIndex] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<Omit<DropdownRef, "open">>(null);

  const handleSetIsOpen = useCallback(
    (o: SetStateAction<boolean>) => {
      jotaiStore.set(openAtom, (prevId) => {
        const prevIsOpen = prevId === id.current;
        const newIsOpen = typeof o === "function" ? o(prevIsOpen) : o;
        // Persist background color of button until we close the dropdown
        if (newIsOpen) {
          onOpen?.();
          if (buttonRef.current) {
            buttonRef.current.style.backgroundColor = window
              .getComputedStyle(buttonRef.current)
              .getPropertyValue("background-color");
          }
        }
        return newIsOpen ? id.current : null; // Set global atom to current ID to signify open state
      });
    },
    [onOpen],
  );

  // Because a different dropdown can cause ours to close, a useEffect([isOpen]) is the only method
  // we have of detecting the dropdown closed, to do cleanup.
  useEffect(() => {
    if (!isOpen) {
      // Clear persisted BG
      if (buttonRef.current) buttonRef.current.style.backgroundColor = "";
      // Set to different value when opened and closed to force it to update. This is to force
      // <Menu/> to reset its selected-index state, which it does when this prop changes
      setDefaultSelectedIndex(null);
    }
  }, [isOpen]);

  // Pull into variable so linter forces us to add it as a hook dep to useImperativeHandle. If we don't,
  // the ref will not update when menuRef updates, causing stale callback state to be used.
  const menuRefCurrent = menuRef.current;

  useImperativeHandle(
    ref,
    () => ({
      ...menuRefCurrent,
      isOpen: isOpen,
      toggle() {
        if (!isOpen) this.open();
        else this.close();
      },
      open(index?: number) {
        handleSetIsOpen(true);
        setDefaultSelectedIndex(index ?? -1);
      },
      close() {
        handleSetIsOpen(false);
      },
    }),
    [isOpen, handleSetIsOpen, menuRefCurrent],
  );

  useHotKey(hotKeyAction ?? null, () => {
    setDefaultSelectedIndex(0);
    handleSetIsOpen(true);
  });

  const child = useMemo(() => {
    const existingChild = Children.only(children);
    const originalOnClick = existingChild.props?.onClick;
    const props: HTMLAttributes<HTMLButtonElement> & { ref: RefObject<HTMLButtonElement | null> } =
      {
        ...existingChild.props,
        ref: buttonRef,
        "aria-haspopup": "true",
        onClick: (e: MouseEvent<HTMLButtonElement>) => {
          // Call original onClick first if it exists
          originalOnClick?.(e);

          // Only toggle dropdown if event wasn't prevented
          if (!e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            handleSetIsOpen((o) => !o); // Toggle dropdown
          }
        },
      };
    return cloneElement(existingChild, props);
  }, [children, handleSetIsOpen]);

  useEffect(() => {
    buttonRef.current?.setAttribute("aria-expanded", isOpen.toString());
  }, [isOpen]);

  const windowSize = useWindowSize();
  const triggerRect = useMemo(() => {
    if (!windowSize) return null; // No-op to TS happy with this dep
    if (!isOpen) return null;
    return buttonRef.current?.getBoundingClientRect();
  }, [isOpen, windowSize]);

  return (
    <>
      {child}
      <ErrorBoundary name={"Dropdown Menu"}>
        <Menu
          ref={menuRef}
          showTriangle
          triggerRef={buttonRef}
          fullWidth={fullWidth}
          defaultSelectedIndex={defaultSelectedIndex}
          items={items}
          triggerShape={triggerRect ?? null}
          onClose={() => handleSetIsOpen(false)}
          isOpen={isOpen}
        />
      </ErrorBoundary>
    </>
  );
});

export interface ContextMenuProps {
  triggerPosition: { x: number; y: number } | null;
  /**
   * The box the menu belongs to, when the trigger has one.
   *
   * Placement aligns to the trigger's left or right edge depending on the room beside it, so a
   * menu opened from an element wants its real rect. Without one the position is treated as a
   * zero-width point, which is right for a menu opened at the cursor and wrong for one opened
   * from a button.
   */
  triggerRect?: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  /**
   * The element the menu belongs to, so a click on it doesn't count as a click outside.
   *
   * Without this the trigger gets both: the outside-click handler closes the menu on mousedown,
   * then the trigger's own click opens it again, and pressing it looks like it does nothing.
   */
  triggerRef?: RefObject<HTMLElement | null>;
  className?: string;
  items: DropdownProps["items"];
  onClose: () => void;
}

export const ContextMenu = forwardRef<DropdownRef, ContextMenuProps>(function ContextMenu(
  { triggerPosition, triggerRect, triggerRef, className, items, onClose },
  ref,
) {
  const triggerShape = useMemo(
    () =>
      triggerRect ?? {
        top: triggerPosition?.y ?? 0,
        bottom: triggerPosition?.y ?? 0,
        left: triggerPosition?.x ?? 0,
        right: triggerPosition?.x ?? 0,
      },
    [triggerPosition, triggerRect],
  );

  if (triggerPosition == null) return null;

  return (
    <Menu
      isOpen={true} // Always open because we return null if not
      className={className}
      defaultSelectedIndex={null}
      // A menu opened from an element points back at it. One opened at the cursor has nothing
      // to point at, so it goes without.
      showTriangle={triggerRect != null}
      ref={ref}
      items={items}
      onClose={onClose}
      triggerRef={triggerRef}
      triggerShape={triggerShape}
    />
  );
});

interface MenuProps {
  className?: string;
  defaultSelectedIndex: number | null;
  triggerShape: Pick<DOMRect, "top" | "bottom" | "left" | "right"> | null;
  onClose: () => void;
  onCloseAll?: () => void;
  showTriangle?: boolean;
  fullWidth?: boolean;
  isOpen: boolean;
  items: DropdownItem[];
  // Any element, not just a button: a menu can be opened from anything, and this is only ever
  // used to ask whether a click landed on the trigger
  triggerRef?: RefObject<HTMLElement | null>;
  isSubmenu?: boolean;
}

const Menu = forwardRef<Omit<DropdownRef, "open" | "isOpen" | "toggle" | "items">, MenuProps>(
  (
    {
      className,
      isOpen,
      items,
      fullWidth,
      onClose,
      onCloseAll,
      triggerShape,
      defaultSelectedIndex,
      showTriangle,
      triggerRef,
      isSubmenu,
    }: MenuProps,
    ref,
  ) => {
    const [selectedIndex, setSelectedIndex] = useStateWithDeps<number | null>(
      defaultSelectedIndex ?? -1,
      [defaultSelectedIndex],
    );

    const [filter, setFilter] = useState<string>("");

    // Clear filter when menu opens
    useEffect(() => {
      if (isOpen) {
        setFilter("");
      }
    }, [isOpen]);

    const [activeSubmenu, setActiveSubmenu] = useState<{
      item: DropdownItemDefault;
      parent: HTMLButtonElement;
      viaKeyboard?: boolean;
    } | null>(null);

    const mousePosition = useRef({ x: 0, y: 0 });
    const submenuTimeoutRef = useRef<number | null>(null);
    const submenuRef = useRef<HTMLDivElement>(null);

    // HACK: Use a ref to track selectedIndex so our closure functions (eg. select()) can
    //  have access to the latest value.
    const selectedIndexRef = useRef(selectedIndex);
    useEffect(() => {
      selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    const handleClose = useCallback(() => {
      onClose();
      setActiveSubmenu(null);
    }, [onClose]);

    // Close the entire menu hierarchy (used when selecting an item)
    const handleCloseAll = useCallback(() => {
      if (onCloseAll) {
        onCloseAll();
      } else {
        handleClose();
      }
    }, [onCloseAll, handleClose]);

    // Handle type-ahead filtering (only for the deepest open menu)
    const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Skip if this menu has a submenu open - let the submenu handle typing
      if (activeSubmenu) return;

      const isCharacter = e.key.length === 1;
      const isSpecial = e.ctrlKey || e.metaKey || e.altKey;
      if (isCharacter && !isSpecial) {
        e.preventDefault();
        setFilter((f) => f + e.key);
        setSelectedIndex(0);
      } else if (e.key === "Backspace" && !isSpecial) {
        e.preventDefault();
        setFilter((f) => f.slice(0, -1));
      }
    };

    useKey(
      "Escape",
      () => {
        if (!isOpen) return;
        if (activeSubmenu) setActiveSubmenu(null);
        else if (filter !== "") setFilter("");
        else handleClose();
      },
      {},
      [isOpen, filter, setFilter, handleClose, activeSubmenu],
    );

    const handlePrev = useCallback(
      (incrBy = 1) => {
        setSelectedIndex((currIndex) => {
          let nextIndex = (currIndex ?? 0) - incrBy;
          const maxTries = items.length;
          for (let i = 0; i < maxTries; i++) {
            if (items[nextIndex]?.hidden || items[nextIndex]?.type === "separator") {
              nextIndex--;
            } else if (nextIndex < 0) {
              nextIndex = items.length - 1;
            } else {
              break;
            }
          }
          return nextIndex;
        });
      },
      [items, setSelectedIndex],
    );

    const handleNext = useCallback(
      (incrBy = 1) => {
        setSelectedIndex((currIndex) => {
          let nextIndex = (currIndex ?? -1) + incrBy;
          const maxTries = items.length;
          for (let i = 0; i < maxTries; i++) {
            if (items[nextIndex]?.hidden || items[nextIndex]?.type === "separator") {
              nextIndex++;
            } else if (nextIndex >= items.length) {
              nextIndex = 0;
            } else {
              break;
            }
          }
          return nextIndex;
        });
      },
      [items, setSelectedIndex],
    );

    // Ensure selection is on a valid item (not hidden/separator/content)
    useEffect(() => {
      const item = items[selectedIndex ?? -1];
      if (item?.hidden || item?.type === "separator" || item?.type === "content") {
        handleNext();
      }
    }, [selectedIndex, items, handleNext]);

    useKey(
      "ArrowUp",
      (e) => {
        if (!isOpen || activeSubmenu) return;
        e.preventDefault();
        handlePrev();
      },
      {},
      [isOpen, activeSubmenu],
    );

    useKey(
      "ArrowDown",
      (e) => {
        if (!isOpen || activeSubmenu) return;
        e.preventDefault();
        handleNext();
      },
      {},
      [isOpen, activeSubmenu],
    );

    useKey(
      "ArrowLeft",
      (e) => {
        if (!isOpen) return;
        // Only handle if this menu doesn't have an open submenu
        // (let the deepest submenu handle the key first)
        if (activeSubmenu) return;
        // If this is a submenu, ArrowLeft closes it and returns to parent
        if (isSubmenu) {
          e.preventDefault();
          onClose();
        }
      },
      {},
      [isOpen, isSubmenu, activeSubmenu, onClose],
    );

    const handleSelect = useCallback(
      async (item: DropdownItem, parentEl?: HTMLButtonElement) => {
        // Handle click-to-open submenu
        if ("submenu" in item && item.submenu && item.submenuOpenOnClick && parentEl) {
          setActiveSubmenu({ item, parent: parentEl });
          return;
        }

        if (!("onSelect" in item) || !item.onSelect) return;
        setSelectedIndex(null);

        const promise = item.onSelect();
        if (item.waitForOnSelect) {
          try {
            await promise;
          } catch {
            // Nothing
          }
        }

        if (!item.keepOpenOnSelect) {
          handleCloseAll();
        } else if (isSubmenu) {
          // Keep the parent menu open, but close this submenu — its items may no
          // longer describe the row after the action (e.g. Pin → Unpin, Remove)
          handleClose();
        }
      },
      [handleCloseAll, handleClose, isSubmenu, setSelectedIndex],
    );

    useImperativeHandle(ref, () => {
      return {
        close: handleClose,
        prev: handlePrev,
        next: handleNext,
        select: async () => {
          const item = items[selectedIndexRef.current ?? -1] ?? null;
          if (!item) return;
          await handleSelect(item);
        },
      };
    }, [handleClose, handleNext, handlePrev, handleSelect, items]);

    const styles = useMemo<{
      container: CSSProperties;
      menu: CSSProperties;
      triangle: CSSProperties;
      upsideDown: boolean;
    }>(() => {
      if (triggerShape == null) return { container: {}, triangle: {}, menu: {}, upsideDown: false };

      if (isSubmenu) {
        const parentRect = triggerShape;
        const docRect = document.documentElement.getBoundingClientRect();
        const spaceRight = docRect.width - parentRect.right;
        const spaceBelow = docRect.height - parentRect.top;
        const spaceAbove = parentRect.bottom;
        const openLeft = spaceRight < 200; // Heuristic to open on left if not enough space on right
        // Estimate submenu height (items * ~28px + padding), flip if not enough space below
        const estimatedHeight = items.length * 28 + 20;
        const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

        return {
          upsideDown: openUpward,
          container: {
            top: openUpward ? undefined : parentRect.top,
            bottom: openUpward ? docRect.height - parentRect.bottom : undefined,
            left: openLeft ? undefined : parentRect.right,
            right: openLeft ? docRect.width - parentRect.left : undefined,
          },
          menu: {
            maxHeight: `${(openUpward ? spaceAbove : spaceBelow) - 20}px`,
          },
          triangle: {}, // No triangle for submenus
        };
      }

      const menuMarginY = 5;
      const docRect = document.documentElement.getBoundingClientRect();
      const width = triggerShape.right - triggerShape.left;
      const heightAbove = triggerShape.top;
      const heightBelow = docRect.height - triggerShape.bottom;
      const horizontalSpaceRemaining = docRect.width - triggerShape.left;
      const top = triggerShape.bottom;
      const onRight = horizontalSpaceRemaining < 300;
      const upsideDown = heightBelow < heightAbove && heightBelow < items.length * 25 + 20 + 200;
      const triggerWidth = triggerShape.right - triggerShape.left;
      return {
        upsideDown,
        container: {
          top: !upsideDown ? top + menuMarginY : undefined,
          bottom: upsideDown
            ? docRect.height - top - (triggerShape.top - triggerShape.bottom) + menuMarginY
            : undefined,
          right: onRight ? docRect.width - triggerShape.right : undefined,
          left: !onRight ? triggerShape.left : undefined,
          minWidth: fullWidth ? triggerWidth : undefined,
          maxWidth: "40rem",
        },
        triangle: {
          width: "0.4rem",
          height: "0.4rem",
          ...(onRight
            ? { right: width / 2, marginRight: "-0.2rem" }
            : { left: width / 2, marginLeft: "-0.2rem" }),
          ...(upsideDown
            ? { bottom: "-0.2rem", rotate: "225deg" }
            : { top: "-0.2rem", rotate: "45deg" }),
        },
        menu: {
          maxHeight: `${(upsideDown ? heightAbove : heightBelow) - 15}px`,
        },
      };
    }, [fullWidth, items.length, triggerShape, isSubmenu]);

    const filteredItems = useMemo(
      () => items.filter((i) => getNodeText(i.label).toLowerCase().includes(filter.toLowerCase())),
      [items, filter],
    );

    const handleFocus = useCallback(
      (i: DropdownItem) => {
        const index = filteredItems.indexOf(i) ?? null;
        setSelectedIndex(index);
      },
      [filteredItems, setSelectedIndex],
    );

    useKey(
      "ArrowRight",
      (e) => {
        if (!isOpen || activeSubmenu) return;
        const item = filteredItems[selectedIndex ?? -1];
        if (item?.type !== "separator" && item?.type !== "content" && item?.submenu) {
          e.preventDefault();
          const parent = document.activeElement as HTMLButtonElement;
          if (parent) {
            setActiveSubmenu({ item, parent, viaKeyboard: true });
          }
        }
      },
      {},
      [isOpen, activeSubmenu, filteredItems, selectedIndex],
    );

    useKey(
      "Enter",
      (e) => {
        if (!isOpen || activeSubmenu) return;
        const item = filteredItems[selectedIndex ?? -1];
        if (!item || item.type === "separator" || item.type === "content") return;
        e.preventDefault();
        if (item.submenu && item.submenuTrigger !== "button") {
          const parent = document.activeElement as HTMLButtonElement;
          if (parent) {
            setActiveSubmenu({ item, parent, viaKeyboard: true });
          }
        } else if (item.onSelect) {
          fireAndForget(handleSelect(item));
        }
      },
      {},
      [isOpen, activeSubmenu, filteredItems, selectedIndex, handleSelect],
    );

    const handleItemHover = useCallback(
      (item: DropdownItemDefault, parent: HTMLButtonElement) => {
        if (submenuTimeoutRef.current) {
          clearTimeout(submenuTimeoutRef.current);
        }

        if (item.submenu && !item.submenuOpenOnClick && item.submenuTrigger !== "button") {
          setActiveSubmenu({ item, parent });
        } else if (activeSubmenu && activeSubmenu.item !== item) {
          // Hovering the row that owns the open submenu must not dismiss it — the
          // pointer travels across the row on its way to a button-triggered submenu
          submenuTimeoutRef.current = window.setTimeout(() => {
            const submenuEl = submenuRef.current;
            if (!submenuEl || !activeSubmenu) {
              setActiveSubmenu(null);
              return;
            }

            const { parent } = activeSubmenu;
            const parentRect = parent.getBoundingClientRect();
            const submenuRect = submenuEl.getBoundingClientRect();
            const mouse = mousePosition.current;

            if (
              mouse.x >= submenuRect.left &&
              mouse.x <= submenuRect.right &&
              mouse.y >= submenuRect.top &&
              mouse.y <= submenuRect.bottom
            ) {
              return;
            }

            const tolerance = 5;
            const p1 = { x: parentRect.right, y: parentRect.top - tolerance };
            const p2 = { x: parentRect.right, y: parentRect.bottom + tolerance };
            const p3 = { x: submenuRect.left, y: submenuRect.top - tolerance };
            const p4 = { x: submenuRect.left, y: submenuRect.bottom + tolerance };

            const inTriangle =
              isPointInTriangle(mouse, p1, p2, p4) || isPointInTriangle(mouse, p1, p3, p4);

            if (!inTriangle) {
              setActiveSubmenu(null);
            }
          }, 100);
        }
      },
      [activeSubmenu],
    );

    const menuRef = useRef<HTMLDivElement | null>(null);
    useClickOutside(menuRef, handleClose, triggerRef);

    // Keep focus on menu container when filtering leaves no items
    useEffect(() => {
      if (filteredItems.length === 0 && filter && menuRef.current) {
        menuRef.current.focus();
      }
    }, [filteredItems.length, filter]);

    const submenuTriggerShape = useMemo(() => {
      if (!activeSubmenu) return null;
      const rect = activeSubmenu.parent.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    }, [activeSubmenu]);

    const handleMouseMove = (event: React.MouseEvent) => {
      mousePosition.current = { x: event.clientX, y: event.clientY };
    };

    const menuContent = (
      <m.div
        ref={menuRef}
        tabIndex={0}
        onKeyDown={handleMenuKeyDown}
        onMouseMove={handleMouseMove}
        onContextMenu={(e) => {
          // Prevent showing any ancestor context menus
          e.stopPropagation();
          e.preventDefault();
        }}
        initial={{ opacity: 0, y: (styles.upsideDown ? 1 : -1) * 5, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        role="menu"
        aria-orientation="vertical"
        dir="ltr"
        style={styles.container}
        className={classNames(
          className,
          "x-theme-menu",
          "outline-hidden my-1 pointer-events-auto z-40",
          "fixed",
        )}
      >
        {showTriangle && !isSubmenu && (
          <span
            aria-hidden
            style={styles.triangle}
            className="bg-surface absolute border-border-subtle border-t border-l"
          />
        )}
        <VStack
          style={styles.menu}
          className={classNames(
            className,
            "h-auto bg-surface rounded-md shadow-lg py-1.5 border",
            "border-border-subtle overflow-y-auto overflow-x-hidden mx-0.5",
          )}
        >
          {filter && (
            <HStack
              space={2}
              className="pb-0.5 px-1.5 mb-2 text-sm border border-border-subtle mx-2 rounded-sm font-mono h-xs"
            >
              <Icon icon="search" size="xs" />
              <div className="text">{filter}</div>
            </HStack>
          )}
          {filteredItems.length === 0 && (
            <span className="text-text-subtlest text-center px-2 py-1">No matches</span>
          )}
          {filteredItems.map((item, i) => {
            if (item.hidden) {
              return null;
            }
            if (item.type === "separator") {
              return (
                <Separator
                  // oxlint-disable-next-line no-array-index-key -- Nothing else available
                  key={i}
                  className={classNames("my-1.5", item.label ? "ml-2" : null)}
                  action={item.action}
                >
                  {item.label}
                </Separator>
              );
            }
            if (item.type === "content") {
              return (
                // oxlint-disable-next-line no-array-index-key -- index is fine
                <div key={i} className={classNames("my-1 mx-2 max-w-xs")} onClick={onClose}>
                  {item.label}
                </div>
              );
            }
            const isParentOfActiveSubmenu = activeSubmenu?.item === item;
            return (
              <MenuItem
                focused={i === selectedIndex}
                isParentOfActiveSubmenu={isParentOfActiveSubmenu}
                onFocus={handleFocus}
                onSelect={handleSelect}
                onHover={handleItemHover}
                onOpenSubmenu={(item, el) => setActiveSubmenu({ item, parent: el })}
                // oxlint-disable-next-line no-array-index-key -- It's fine
                key={i}
                item={item}
              />
            );
          })}
        </VStack>
        {activeSubmenu && (
          <div
            ref={submenuRef}
            onMouseEnter={() => {
              if (submenuTimeoutRef.current) {
                clearTimeout(submenuTimeoutRef.current);
              }
            }}
          >
            <Menu
              isSubmenu
              isOpen
              items={activeSubmenu.item.submenu ?? []}
              defaultSelectedIndex={activeSubmenu.viaKeyboard ? 0 : null}
              onClose={() => setActiveSubmenu(null)}
              onCloseAll={handleCloseAll}
              triggerShape={submenuTriggerShape}
            />
          </div>
        )}
      </m.div>
    );

    // Hotkeys must be rendered even when menu is closed (so they work globally)
    const hotKeyElements = items.map(
      (item, i) =>
        item.type !== "separator" &&
        item.type !== "content" &&
        !item.hotKeyLabelOnly &&
        item.hotKeyAction && (
          <MenuItemHotKey
            key={`${item.hotKeyAction}::${i}`}
            onSelect={handleSelect}
            item={item}
            action={item.hotKeyAction}
          />
        ),
    );

    if (!isOpen) {
      return <>{hotKeyElements}</>;
    }

    if (isSubmenu) {
      return menuContent;
    }

    return (
      <>
        {hotKeyElements}
        <Overlay noBackdrop open={isOpen} portalName="dropdown-menu">
          {menuContent}
        </Overlay>
      </>
    );
  },
);

interface MenuItemProps {
  className?: string;
  item: DropdownItemDefault;
  onSelect: (item: DropdownItemDefault, el?: HTMLButtonElement) => Promise<void>;
  onFocus: (item: DropdownItemDefault) => void;
  onHover: (item: DropdownItemDefault, el: HTMLButtonElement) => void;
  onOpenSubmenu: (item: DropdownItemDefault, el: HTMLButtonElement) => void;
  focused: boolean;
  isParentOfActiveSubmenu?: boolean;
}

function MenuItem({
  className,
  focused,
  onFocus,
  onHover,
  item,
  onSelect,
  onOpenSubmenu,
  isParentOfActiveSubmenu,
  ...props
}: MenuItemProps) {
  const [isLoading, setIsLoading] = useState(false);
  const handleClick = useCallback(async () => {
    if (item.waitForOnSelect) setIsLoading(true);
    await onSelect?.(item, buttonRef.current ?? undefined);
    if (item.waitForOnSelect) setIsLoading(false);
  }, [item, onSelect]);

  const handleFocus = useCallback(
    (e: ReactFocusEvent<HTMLButtonElement>) => {
      e.stopPropagation(); // Don't trigger focus on any parents
      return onFocus?.(item);
    },
    [item, onFocus],
  );

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const initRef = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el;
      if (el === null) return;
      if (focused) {
        setTimeout(() => el.focus(), 0);
      }
    },
    [focused],
  );

  const handleMouseEnter = (e: MouseEvent<HTMLButtonElement>) => {
    onHover(item, e.currentTarget);
    e.currentTarget.focus();
  };

  const hasButtonSubmenu = item.submenu != null && item.submenuTrigger === "button";

  const rightSlot =
    item.submenu && !hasButtonSubmenu ? (
      <Icon icon="chevron_right" color="secondary" />
    ) : (
      (item.rightSlot ?? <Hotkey variant="text" action={item.hotKeyAction ?? null} />)
    );

  const button = (
    <Button
      ref={initRef}
      size="sm"
      tabIndex={-1}
      onMouseEnter={hasButtonSubmenu ? undefined : handleMouseEnter}
      onMouseLeave={hasButtonSubmenu ? undefined : (e) => e.currentTarget.blur()}
      disabled={item.disabled}
      onFocus={handleFocus}
      onClick={handleClick}
      justify="start"
      leftSlot={
        (isLoading || item.leftSlot || item.icon) && (
          <div className={classNames("pr-2 flex justify-start [&_svg]:opacity-70")}>
            {isLoading ? <LoadingIcon /> : item.icon ? <Icon icon={item.icon} /> : item.leftSlot}
          </div>
        )
      }
      rightSlot={rightSlot && <div className="ml-auto pl-3">{rightSlot}</div>}
      innerClassName="text-left!"
      color="custom"
      className={classNames(
        className,
        "h-xs", // More compact
        "min-w-32 outline-hidden px-2 mx-1.5 flex whitespace-nowrap",
        "focus:bg-surface-highlight focus:text rounded-sm focus:outline-hidden focus-visible:outline-1",
        isParentOfActiveSubmenu && "bg-surface-highlight text rounded-sm",
        hasButtonSubmenu && "pr-8",
        item.color === "danger" && "text-danger!",
        item.color === "primary" && "text-primary!",
        item.color === "success" && "text-success!",
        item.color === "warning" && "text-warning!",
        item.color === "notice" && "text-notice!",
        item.color === "info" && "text-info!",
      )}
      {...props}
    >
      <div className={classNames("truncate min-w-20")}>{item.label}</div>
    </Button>
  );

  if (!hasButtonSubmenu) {
    return button;
  }

  // The submenu trigger overlays the row as a sibling (not a child) because the row is
  // itself a button and buttons cannot nest. Hover handling lives on this wrapper so the
  // row keeps its focus highlight while the mouse is over the trigger.
  return (
    <div
      className="relative grid group/menuitem"
      onMouseEnter={() => {
        const el = buttonRef.current;
        if (el == null) return;
        onHover(item, el);
        el.focus();
      }}
      onMouseLeave={() => buttonRef.current?.blur()}
    >
      {button}
      <div
        className={classNames(
          "absolute right-1.5 inset-y-0 flex items-center",
          "opacity-0 group-hover/menuitem:opacity-100 group-focus-within/menuitem:opacity-100",
        )}
      >
        <IconButton
          color="custom"
          size="2xs"
          tabIndex={-1}
          icon="ellipsis_vertical"
          iconColor="secondary"
          title="More actions"
          className="h-full! w-7!"
          onMouseDown={(e) => {
            // Prevent the trigger from stealing focus, which would unhighlight the row
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSubmenu(item, e.currentTarget);
          }}
        />
      </div>
    </div>
  );
}

interface MenuItemHotKeyProps {
  action: HotkeyAction | undefined;
  onSelect: MenuItemProps["onSelect"];
  item: MenuItemProps["item"];
}

function MenuItemHotKey({ action, onSelect, item }: MenuItemHotKeyProps) {
  useHotKey(action ?? null, () => onSelect(item));
  return null;
}

function sign(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
) {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

function isPointInTriangle(
  pt: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  v3: { x: number; y: number },
) {
  const d1 = sign(pt, v1, v2);
  const d2 = sign(pt, v2, v3);
  const d3 = sign(pt, v3, v1);

  const has_neg = d1 < 0 || d2 < 0 || d3 < 0;
  const has_pos = d1 > 0 || d2 > 0 || d3 > 0;

  return !(has_neg && has_pos);
}
