import { useEffect, useRef, useState } from "react";

/**
 * One entry in a context menu.
 *
 * `submenu` and `onSelect` are alternatives: an item either does something or
 * opens a list of things that do.
 */
export type MenuItem =
  | { kind: "separator" }
  | {
      kind?: "item";
      label: string;
      onSelect?: (() => void) | undefined;
      /** Shown greyed and skipped by the keyboard, rather than hidden. */
      disabled?: boolean | undefined;
      submenu?: MenuItem[] | undefined;
    };

export type MenuPosition = { x: number; y: number };

/** Distance kept from the viewport edge when a menu would overflow it. */
const MARGIN = 8;

function isActionable(item: MenuItem): item is Extract<MenuItem, { kind?: "item" }> {
  return item.kind !== "separator" && !item.disabled;
}

/**
 * A context menu positioned at the pointer.
 *
 * Built rather than borrowed: a native OS menu through Tauri cannot cheaply
 * render a live list of playlists, and the app suppresses the webview's own
 * menu. It is a real menu, not a styled list - arrow keys move, Enter picks,
 * Escape closes, and focus returns where it came from.
 */
export function ContextMenu({
  items,
  position,
  onClose,
  label = "Context menu",
}: {
  items: MenuItem[];
  position: MenuPosition;
  onClose: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => items.findIndex(isActionable));
  /** Which item's submenu is open, if any. */
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [placed, setPlaced] = useState<MenuPosition>(position);

  // Measure, then nudge back inside the viewport. Done after layout rather
  // than by guessing a height, because the playlist submenu makes the menu's
  // size depend on the library.
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    setPlaced({
      x: Math.max(MARGIN, Math.min(position.x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(position.y, window.innerHeight - height - MARGIN)),
    });
  }, [position]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // A menu that survives the thing it acts on moving is worse than one that
  // closes: scrolling the table under an open menu would leave it pointing at
  // a different row.
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    // Capture, so a click outside closes the menu before it reaches whatever
    // it landed on - clicking a row should not also select it.
    window.addEventListener("mousedown", onPointerDown, true);
    return () => window.removeEventListener("mousedown", onPointerDown, true);
  }, [onClose]);

  const step = (from: number, delta: number): number => {
    for (let i = 1; i <= items.length; i++) {
      const next = (from + delta * i + items.length * items.length) % items.length;
      if (isActionable(items[next] as MenuItem)) {
        return next;
      }
    }
    return from;
  };

  const choose = (index: number) => {
    const item = items[index];
    if (!item || !isActionable(item)) {
      return;
    }
    if (item.submenu) {
      setOpenSub(index);
      return;
    }
    item.onSelect?.();
    onClose();
  };

  return (
    // A div rather than a ul: `role="menu"` carries the semantics, and putting
    // an interactive role on a list element is the kind of mismatch a screen
    // reader has to guess its way through.
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: placed.x, top: placed.y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (openSub !== null) {
            setOpenSub(null);
          } else {
            onClose();
          }
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => step(index, 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => step(index, -1));
        } else if (event.key === "ArrowRight") {
          const item = items[active];
          if (item && isActionable(item) && item.submenu) {
            event.preventDefault();
            setOpenSub(active);
          }
        } else if (event.key === "ArrowLeft" && openSub !== null) {
          event.preventDefault();
          setOpenSub(null);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(active);
        } else if (event.key === "Home") {
          event.preventDefault();
          setActive(items.findIndex(isActionable));
        } else if (event.key === "End") {
          event.preventDefault();
          setActive(step(0, -1));
        }
      }}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          // An <hr> is already a separator to a screen reader, so it needs no
          // role - and no aria-valuenow, which an explicit one would require.
          // biome-ignore lint/suspicious/noArrayIndexKey: a menu's items are a fixed list built at open time, never reordered.
          return <hr key={`sep-${index}`} className="context-separator" />;
        }
        return (
          <div key={item.label} className="context-row" role="none">
            <button
              type="button"
              role="menuitem"
              className={[
                "context-item",
                index === active ? "active" : "",
                item.submenu ? "has-submenu" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={item.disabled}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? openSub === index : undefined}
              tabIndex={-1}
              onMouseEnter={() => {
                setActive(index);
                setOpenSub(item.submenu ? index : null);
              }}
              onClick={() => choose(index)}
            >
              {item.label}
              {item.submenu ? (
                <span className="context-arrow" aria-hidden="true">
                  ▸
                </span>
              ) : null}
            </button>
            {item.submenu && openSub === index ? (
              <div className="context-menu context-submenu" role="menu" aria-label={item.label}>
                {item.submenu.length === 0 ? (
                  <div className="context-empty">No playlists yet</div>
                ) : (
                  item.submenu.map((sub) =>
                    sub.kind === "separator" ? null : (
                      <div key={sub.label} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          className="context-item"
                          disabled={sub.disabled}
                          tabIndex={-1}
                          onClick={() => {
                            sub.onSelect?.();
                            onClose();
                          }}
                        >
                          {sub.label}
                        </button>
                      </div>
                    ),
                  )
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
