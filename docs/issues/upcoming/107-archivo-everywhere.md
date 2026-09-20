# 107 — Archivo everywhere

Study **7a Ember** is settled: one face doing everything. Segoe UI and Space
Grotesk both go.

`@fontsource/archivo`, latin subset, weights 400, 600 and 800 — vendored the way
Space Grotesk is, because the CSP forbids a font CDN and the app is offline
first. `--font-numeric` is deleted; figures are Archivo with
`font-variant-numeric: tabular-nums`.

The scale the sheet uses, in full:

| Role | Value |
| --- | --- |
| Section heading | `800 26px/1.1`, `-.02em` |
| Release header | `800 24px/1.05`, `-.02em` |
| Dialog title | `800 17px/1.1`; paned dialog `800 16px` |
| Stat figure | `800 28px/1`, tabular; tile figure `800 24px/1` |
| Row text | `400 12.5px/1` |
| Duration, count | `400 12px/1`, tabular |
| Button label | `800 13px/1.2`, centred; small `800 12px/1` |
| Field label | `400 11px/1` or `11.5px/1` |
| Eyebrow | `800 9.5–10px/1`, `.11–.14em`, uppercase |
| Badge | `800 10.5px/1`, `.06em`, uppercase |

`App.css.test.ts` "uses the numeral face for numbers and not for prose" inverts:
the assertion becomes that no rule names a second family, and that every
element drawing a figure carries `tabular-nums`.

Centred button labels are the sheet's one departure from flush-left, stated in
section 01: "a desktop action reads as a target rather than a line of text".

Part of the [component library sweep](../../plans/apex-components.md).
