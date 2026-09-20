# 111 — Drawn controls

Section 02. "Every widget is drawn, not inherited from the browser." The app
uses native `input[type=checkbox|radio]` and `select`; all of them are replaced,
and a switch arrives that the app does not have.

| Control | Drawn |
| --- | --- |
| `Checkbox` | 15px box. On: accent fill, `#201e1d` / `#17140f` tick at stroke 3.5. Off: `1.5px` border `#9b9694` / `#5b5147` over surface. Mixed: accent fill, 8×2px bar. |
| `Radio` | 15px box, `1.5px` accent border, 7px accent dot. Off: `1.5px` neutral border, empty. |
| `Switch` | 34×18, 2px padding, 14px knob. On: accent track, ground-coloured knob, knob right. Off: `#c4c0bd` / `#4a4138` track, knob left. |
| `Select` | surface fill, line border, `7px 9px`, label left and a 12px chevron right. Focused/active takes an accent border. |
| `SearchField` | surface fill, line border, `7px 9px`, 13px magnifier at muted, `gap: 7px`. |
| `SegmentedControl` | one line border around the set, `7px 13px` a segment, `1px` line between them, selected is accent fill on ground-coloured text, `800 12px`. |
| `Slider` | 3px rail, accent fill to the value, an 11px **square** ink knob sitting `-4px` above the rail. Readout right, tabular, muted. |

Every one keeps a 24px minimum hit area around a smaller drawn mark, and every
one keeps the label association and keyboard behaviour the native element gave
away. Base UI where it has the behaviour (`Select`, `Slider`, `Switch`); the
primitive is what the app imports.

Migrate the existing callers in the same issue — the modal selects, the smart
playlist rule rows, the stats filter selects, the settings checkboxes and the
tag editor's field toggles. A half-replaced control set is two widget languages
in one dialog.

`Scrubber` and `VolumeControl` are the playhead and the volume rail; they wear
the design's transport treatment, not this slider, and stay as they are.

Part of the [component library sweep](../../plans/apex-components.md).
