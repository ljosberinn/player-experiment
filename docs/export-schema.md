# Export schema

The JSON Apex writes from **Export** is a published contract. It is versioned
and meant to be scripted against.

`schemaVersion` is **1**.

## Compatibility

- **Adding a field is not a breaking change.** Read the document with a parser
  that ignores keys it does not know, and a newer Apex will keep working.
- `schemaVersion` is bumped only when a field is **removed or reinterpreted**.
- **`generator.name` changed from `"player"` to `"apex"`** when the app was
  renamed. `schemaVersion` did not move: the field still means what it always
  meant — the name of the app that wrote the file — and that name is now Apex.
  A reader that matched on the literal `"player"` was matching on a value the
  schema never promised to hold still. Match on `schemaVersion` instead.
- Field names are `camelCase` throughout.
- Times are **Unix seconds**, integers, UTC.

## Top level

```json
{
  "schemaVersion": 1,
  "exportedAt": 1735689600,
  "generator": { "name": "apex", "version": "0.1.0" },
  "scope": "library",
  "tracks": [],
  "playlists": [],
  "settings": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | See above. |
| `exportedAt` | integer | When the file was written. |
| `generator` | object | `name` and `version` of the app that wrote it. |
| `scope` | string | `"library"`, `"selection"` or `"playlist"`. |
| `tracks` | array | See below. |
| `playlists` | array | Empty for a selection export. |
| `settings` | array | **Only present for a library export**, and only ever app preferences — see "What is deliberately absent". |

## Scopes

- **`library`** — every track, every playlist, and the exportable settings.
- **`selection`** — only the tracks that were selected, in the order they were
  selected. No playlists, no settings: a selection is a fragment of a library,
  not a backup of one.
- **`playlist`** — one playlist and the tracks in it, **in the playlist's own
  order**. A smart playlist exports the tracks its filter matched at the moment
  of export, alongside the filter itself.

## `tracks[]`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Stable within one library; `playlists[].trackIds` refers to it. |
| `path` | string | Absolute path, in the OS's own form. |
| `durationMs` | integer | |
| `title`, `artist`, `album`, `albumArtist`, `genre`, `comment` | string or null | Null means the tag is absent. Blank tags are read as absent. |
| `year`, `trackNo`, `discNo`, `bitrate`, `sampleRate` | integer or null | |
| `addedAt` | integer | When the scan first saw the file. |
| `playCount` | integer | |
| `lastPlayedAt` | integer or null | |

## `playlists[]`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | |
| `name` | string | |
| `kind` | string | `"static"` or `"smart"`. |
| `createdAt` | integer | |
| `trackIds` | array of integer | **Static playlists only**, in playlist order. |
| `filter` | object | **Smart playlists only** — the filter tree, not a snapshot of its members. |
| `order` | object | **Smart playlists only, and only when it has one** — the sort and cutoff. |

Exactly one of `trackIds` and `filter` is present, which tells a reader which
kind it is holding without having to trust `kind`.

A smart playlist exports its **filter** rather than a membership list, because
a membership list would be a lie the moment the library changed. The filter's
shape is a group of rules:

```json
{
  "combinator": "all",
  "children": [
    { "type": "rule", "field": "artist", "op": "is",
      "value": { "kind": "text", "text": "Grizzly Bear" } },
    { "type": "group", "combinator": "any", "children": [] }
  ]
}
```

`combinator` is `all` or `any`. Each child is either a `rule` or a nested
`group`. A rule's `value` is one of `{"kind":"text","text":…}`,
`{"kind":"number","number":…}`, `{"kind":"range","from":…,"to":…}`, or
`{"kind":"none"}` for operators that take no value.

### `order`

A smart playlist may also carry a sort and a cutoff:

```json
{ "sort": { "field": "playCount", "direction": "desc" }, "limit": 100 }
```

Both parts are independently nullable, and the whole key is **omitted** when
neither is set — which is what every export written before this field existed
looks like, so those remain valid documents at the same `schemaVersion`.

`limit` is what makes a playlist like "Most Played" expressible, and it is a
statement about **membership**, not about display: the playlist holds that many
songs, chosen by `sort`. A reader reconstructing the playlist has to apply the
sort and the cutoff as part of evaluating the filter, not afterwards to whatever
the filter returned — those give different answers as soon as anything else
narrows the view.

`field` is one of the track columns (`title`, `artist`, `album`, `albumArtist`,
`genre`, `year`, `trackNo`, `durationMs`, `addedAt`, `playCount`,
`lastPlayedAt`, `path`); `direction` is `asc` or `desc`.

## `settings[]`

`{ "key": "player.volume", "value": "0.8" }` — app preferences only.

## What is deliberately absent

- **Artwork, in every form.** Not the bytes — large, binary, and already
  inside the audio files — and not a hash identifying them either. An export
  carries the library's text; the pictures stay in the files they came from.
- **Credentials of any kind.** Settings are filtered through an **allowlist**,
  not a denylist, so a key added by a future feature is excluded by default
  rather than by someone remembering to exclude it. A last.fm session key or a
  Discogs token cannot appear in an export even if a future release forgets to
  think about it.
