# 52 — A one-rule smart playlist should name itself

A brand new smart playlist whose filter is a single rule derives its name
from the rule's value ("Artist is Rome" → **Rome**) live in the editor's name
field, before Save. `src/features/smart/nameFromRule.ts` holds the pure logic;
`SmartPlaylistEditor` wires it in.

- **Only a single root-level rule derives.** Zero rules, several, or a nested
  group offer nothing (`suggestedName` returns `null`) and the field falls
  back to the default it opened with.
- **Only a brand new playlist derives** — `isNew` prop, set from
  `editing.playlistId === null` in `App.tsx`. Editing an existing playlist
  never touches its name.
- **A value with no one-line reading offers nothing**: empty text, a range,
  or a valueless op (`isEmpty`/`isNotEmpty`).
- **Typing into the name field stops derivation for the rest of the editor
  session**, tracked by a ref so flipping it does not itself cause a render.
  Retyping the default stops it like any other edit. Retyping the exact
  sentence the rule's own controls already show ("Artist is Rome") does not —
  `isUninformative` treats that string as carrying exactly as little
  information as the default it would replace, so the rule can keep updating
  the field until the user types something that is actually theirs.
