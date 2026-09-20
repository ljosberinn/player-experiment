# 109 — Radius zero

All 48 `border-radius` declarations gone from `styles/app.css`. Nothing in the
app rounds a corner now, and `App.css.test.ts` asserts no rule declares a
non-zero one — it scans the raw source rather than the parsed rules, because a
radius reintroduced inside a nested block is the same regression and the parser
cannot see in there. `border-radius: 0` stays legal: that is how a UA style gets
reset, which is the opposite of the thing being guarded.

Two effects lost their roundness without being declarations of their own: the
play button's halo and the cover art's hairline ring, both drawn as spread
shadows that took their shape from the element. Both stay and are square now.
The rule reaches corners, not depth.

One of the 48 was already `0` — the caption buttons, resetting nothing. It went
with the rest rather than staying as the one declaration the guard tolerates.

## The transport

The one control that changed shape rather than softness. A 26px capsule holding
three 50% circles with a 4px gap becomes a band holding three squares — and the
gap had to go with the radius, because three separated squares read as three
unrelated buttons on a slab where three abutting ones read as one segmented
control, which is what section 02 of the component sheet draws.

Everything else in the strip landed on the design's own geometry by subtraction:
the two slider thumbs are now the 11×11 squares the sheet draws, and the search
field is a rectangle.

`e2e/specs/transport.test.ts` already photographs the strip as
`transport-mute-repeat`, so the before is the same shot on the previous build.

## Outside the stylesheet

`charts/Heatmap.tsx` drew its cells with `rx={2}`. It is the only radius the CSS
guard cannot see, and "no exceptions" is the rule, so it went too.

Part of the [component library sweep](../../plans/apex-components.md).
