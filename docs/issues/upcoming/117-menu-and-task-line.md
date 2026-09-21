# 117 — Row menu and the task line

Section 05.

**`Menu`** — 226px wide, dialog fill, `1px solid` line border, `0 3px 10px` /
`0 3px 14px` shadow, `4px 0` padding, `400 12.5px/1`. An item is `7px 12px`,
flush left. A separator is 1px at the separator colour with `4px` margins. A
submarker (`▸`) and a shortcut (`Ctrl+E`) sit right in muted. The highlighted
item takes the selection fill — from state, not `:hover`, which is the rule
`ui/ContextMenu` already follows through Base UI's `data-highlighted`.

Separators group by consequence, and the order the sheet draws is the order:

```
Play
─────
Edit
Get Tags from MusicBrainz…
Add to Playlist            ▸
Love
Remove from Library…
─────
Export 1 Song…
Show in Explorer      Ctrl+E
─────
Open Artist on…            ▸
Open Album on…             ▸
```

The destructive item sits alone above the export group.

**`TaskLine`** — the background task readout. Two muted `400 11.5px/1.35` lines,
what it is doing with the percentage and how long is left, then a **118px** track
4px high with an accent fill at the ratio. Fixed width, so a bar at 0,22% is a
visible sliver rather than a 3px mark on a rail as wide as the sidebar.

`.sidebar-task` is this today and keeps its placement — absent unless something
is running, at the foot of the sidebar.

Part of the [component library sweep](../../plans/apex-components.md).
