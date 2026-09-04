# 79b — Online release lookup

Produces a candidate tag set only; [79a](../done/79a-per-track-edits-and-the-release-mbid.md)'s
per-track writer and phase 8's undo journal apply it. Outbound network, inert
unless the user asks — last.fm and the updater are the ones already there.

**MusicBrainz, and only MusicBrainz.** On the evidence of what else uses it:
Lidarr, Picard and beets are all on it, and Soulseek has no metadata layer to
integrate with at all. Discogs is the secondary everyone reaches for on
electronic and vinyl and was considered — it needs a mandatory token, a stored
credential and a Settings control, for a second opinion on records this library
mostly is not, and the feature is complete without it.

**Call the public API directly from Rust.** Mp3tag's `.src` DSL exists so
non-programmers can add sources without a rebuild; a typed client is our
equivalent. That trade flips only if user-contributed sources are ever wanted.

- **MusicBrainz** — no auth. `GET /ws/2/release?query=…&fmt=json` to search,
  `GET /ws/2/release/<mbid>?inc=recordings+artist-credits+release-groups&fmt=json`
  for the tracklist. `inc` is not accepted on search, so a release costs two
  calls and there is no way to make it cost one.
- **The rate limiter is process-wide, not per client.** Max 1 request/sec is
  enforced at the IP, and exceeding it gets the IP blocked. A limiter owned by a
  client instance lets [82](82-lookup-runs-itself.md)'s background pass and an
  open dialog make two a second between them, so it is a single limiter every
  caller goes through. Same for the meaningful User-Agent built from
  `CARGO_PKG_NAME`/`CARGO_PKG_VERSION` with a contact URL: in the client, never
  at a call site.
- **Cover Art Archive** — keyed by the same release MBID, no auth, and
  **no rate limit**, so covers fetch in parallel while MusicBrainz is the
  bottleneck. `/release/<mbid>/front-500` is exactly the size
  [72](../done/72-covers-are-most-of-the-database.md) stores. A 404 is
  "no cover", not an error.
- **AcoustID is not in this phase.** It batches fingerprints at 3 req/s and
  `rusty-chromaprint` is a pure Rust port, so `unsafe_code = "forbid"` would
  survive it — but fingerprinting means decoding two minutes of every file, and
  it is the answer for what text search cannot match rather than the first pass.

**A release is the unit, not a track.** 65,535 tracks are 8,044 releases, so a
per-track lookup would pay four thousand percent over the odds. Group the
selection by `(album, GROUP_ARTIST)` — `db::query`'s
`coalesce(nullif(tracks.album_artist, ''), nullif(tracks.artist, ''))`, the same
expression the browse view groups by, empty strings and all — and look each
group up once.

**A partial selection is looked up whole and applied narrowly.** Three files out
of a twelve-track release still fetch the twelve-track release, or their track
numbers would be wrong; the confirm dialog then maps onto the three files that
were selected and touches nothing else.

**The MBIDs are the exception: they go to the whole release.** Every track
sharing the selection's `(album, GROUP_ARTIST)` gets them, selected or not.
Otherwise three of twelve tracks carry an identity and nine fall back to the
title, and [87](87-one-release-one-tile.md) draws one release as two tiles —
the defect it exists to remove. They are the only fields where writing outside
the selection is right, because they say which release the file belongs to
rather than what it should be called.

Shape: `src-tauri/src/tagsource/musicbrainz.rs` over an injected HTTP transport,
the way [`lastfm::transport`](../../src-tauri/src/lastfm/transport.rs) does it,
so every rule above it is tested against a fake on a runner with no network. **No
provider trait**: one implementation does not justify one, and a second source is
not planned. Commands `tagsource_search` and `tagsource_fetch`.

UI mirrors Mp3tag's flow because it is the right one: search per release, pick a
result, then a **confirm dialog** mapping remote tracks to selected files (with
manual reorder) and per-field checkboxes. **Artwork is one of those fields**: the
fetched cover previews beside the release's own and, when its box is ticked,
reaches the writer as `CoverEdit::Replace` pointing at a temp file the fetch
wrote — `read_cover` reads the path an edit names, and a temp file costs one
function where a bytes-carrying variant would cost a serde shape and an IPC
payload.

**Score every candidate**, even here where a human confirms —
[82](82-lookup-runs-itself.md) needs the number and cannot invent it later.
Track count and per-track duration agreement against MusicBrainz's own search
score; the dialog sorts by it.

Testing: recorded JSON fixtures incl. multi-disc and various-artists releases;
the limiter asserted to serialize concurrent calls from **two** callers at ≥1s;
the UA header asserted present; the tracklist-to-file mapping asserted over a
partial selection; one `#[ignore]`d live test.

Cost: nothing. Both services are free at this scale.
