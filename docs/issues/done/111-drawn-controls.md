# 111 — Drawn controls

Section 02. Seven primitives in `src/components/primitives/` — `Checkbox`,
`Radio`, `Switch`, `Select`, `SearchField`, `SegmentedControl`, `Slider` —
drawn by `styles/library.css`, with every native `input[type=checkbox|radio]`
and `<select>` in the app migrated onto them in the same change.

Base UI where the behaviour is the hard part: `Select`, `Slider`, `Switch`.
Native underneath the drawing everywhere else — a checkbox's `:indeterminate`,
a radio group's roving tab stop and "exactly one of these", a search field's
caret and clear gesture are all things the platform gets right and a headless
rebuild would have to keep in step.

## Phase 24's stop clause is reversed

The three editors' `<select>`s were kept native on the argument that a native
select in a webview opens a real OS popup, which is closer to native than any
listbox. That was the better answer while the app had no drawn control set. It
is the wrong one after 108: an OS popup draws in the OS's colours, and the
design's whole claim is one token set across both grounds.

A consequence worth having: a drawn select's list is DOM, so WebDriver can
click it. `appearance.test.ts` drove the theme select by assigning through
`HTMLSelectElement.prototype`'s own setter, because a closed native select's
options are an OS popup the driver cannot reach. That helper is gone — the
spec clicks the trigger and the option now, which is also a stronger test.

## Two tokens carry the drawn marks

`--track-border` grew a wider job. For an unticked checkbox, an unselected
radio and a switch that is off, the edge **is** the whole control, and WCAG
1.4.11 asks 3:1 of it. The sheet draws all three at `--field-border`, which is
2.58:1 and 2.57:1 — fine behind a field's own fill and its text, nowhere near
enough on an empty 15px box.

`--rail` is new: the inert part of a control that is partly filled, a switch's
off track and a slider's groove. Deliberately not `--track`, the transport's
rail — one is a line between things and this is a groove. It carries no
threshold of its own; what it has to clear is the knob drawn on it.

`App.css.test.ts` measures every mark against four surfaces per ground, and
finds the dropped-focus-ring bug by its cause rather than by name: any rule
that takes an input's opacity to zero must have a replacement ring somewhere.

## Departures from the sheet

- **The switch's 2px padding is a 1px edge and a 1px gap.** Box and travel are
  the sheet's to the pixel; the split buys the edge at 3:1, without which the
  off state is a pale bar at 1.69:1 on the chrome.
- **The switch knob is `--muted` on both grounds.** The sheet draws the off
  knob in the ground's own colour, which on light is 1.62:1 on its own track —
  and the sheet's own dark column already reaches for the muted tone.
- **The radio is square, with a square dot.** Radius is 0 everywhere since
  109, and a radio is the one control that would have argued for an exception.
  It reads as a radio from where it appears and from the dot inset in a ring.
- **A selected segment takes its focus ring in `--on-accent`**, the primary
  button's problem and the primary button's answer.

## What stayed as it was

`Scrubber` and `VolumeControl` wear the design's transport treatment, not this
slider. The two look different on purpose.

**`Radio` and `SearchField` have no caller.** The migration list in the issue
names neither, and there is no native radio in the app to replace. The
toolbar's `SearchBox` is the one field `SearchField` could have taken, and it
carries a clear button and Enter/Escape handling the primitive does not — so
it stays, and whichever issue redraws the toolbar owns the decision. Both
primitives exist because the sheet specifies them and because the alternative
is the first caller inventing one.

## Smaller things

- **`.stats-filter`'s captions are `<span>`s now.** A `<label>` forwards its
  click to a labelable descendant, and a drawn select's trigger is a
  `<button>` — so the wrapper was labelling nothing and reading the caption
  and the value out as one string. The two date fields keep theirs.
- **`Select` holds its value when Base UI reports `null`.** There is no empty
  item and no clear affordance, so a null would mean the list changed under
  the value.
- **`alignItemWithTrigger` is off.** It overlaps the popup on the trigger, the
  way macOS does; every other menu in this app drops below what opened it.
- `expand` and `search` joined the icon registry. `expand` is the regular-
  weight caret `move-down` is the bold version of — one moves a row, the other
  says a list will drop.
- The app.css rules for the elements this replaced are gone: `.modal select`,
  `.filter-rule select`, `.stats-filter select`, `.lookup-field`.

Part of the [component library sweep](../../plans/apex-components.md).
