import { Select as Base } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

/** One line of the list. `disabled` still shows it - it says the value exists. */
export interface SelectOption<Value extends string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean | undefined;
}

/**
 * A select, drawn rather than opened by the OS.
 *
 * **This reverses phase 24's stop clause**, which kept the three editors'
 * `<select>`s native because a native select in a webview opens a real OS
 * popup. That was the better answer while the app had no drawn control set;
 * it is the wrong one now, because an OS popup draws in the OS's colours and
 * the design's whole claim is one token set across both grounds. A window
 * whose every other control is drawn and whose selects are not is two widget
 * languages in one dialog. See docs/issues/done/111-drawn-controls.md.
 *
 * Base UI underneath, for the same reason the menus are: type-ahead,
 * collision nudging, focus restoration and the listbox roles are all behaviour
 * rather than drawing, and all of them were free while the element was native.
 *
 * Named by `label`, which becomes `aria-label`, or by `id` when something
 * outside already names it - a `<label htmlFor>` finds the trigger, a button
 * being labelable. A caller that has a visible label in its own layout passes
 * `id`; one that has none passes `label`.
 */
export function Select<Value extends string>({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string;
  label?: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <Base.Root
      items={options as { value: Value; label: ReactNode }[]}
      value={value}
      disabled={disabled}
      // Base UI hands back `null` when a selection is cleared, which this
      // control has no way to reach: there is no empty item and no clear
      // affordance, so a null would mean the list changed under the value.
      // Holding the current one is the honest answer to that.
      onValueChange={(next) => onChange(next ?? value)}
    >
      <Base.Trigger id={id} aria-label={label} className="select">
        <Base.Value className="select-value" />
        <Base.Icon className="select-chevron" render={<Icon name="expand" size={12} />} />
      </Base.Trigger>

      <Base.Portal>
        {/* `alignItemWithTrigger` off. It overlaps the popup on the trigger so
            the chosen line sits where the value was, which is the macOS
            behaviour; every menu in this app drops below what opened it, and
            one list that covers its own control reads as a different widget. */}
        <Base.Positioner className="select-positioner" alignItemWithTrigger={false} sideOffset={2}>
          <Base.Popup className="select-popup">
            <Base.List>
              {options.map((option) => (
                <Base.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="select-item"
                >
                  <Base.ItemText>{option.label}</Base.ItemText>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
