# 12 — Online tag lookup (MusicBrainz + Discogs)

Produces a candidate tag set only; phase 8's atomic writer and undo journal
apply it. Second outbound network dependency, inert unless the user opens the
lookup dialog.

**Call the public APIs directly from Rust.** Mp3tag's `.src` DSL exists so
non-programmers can add sources without a rebuild; two typed clients are our
equivalent. That trade flips only if user-contributed sources are ever wanted.

- **MusicBrainz** — no auth. `GET /ws/2/release?query=…&fmt=json` to search,
  `GET /ws/2/release/<mbid>?inc=recordings+artist-credits+labels&fmt=json` for
  the tracklist. Two hard rules, both enforced **in the client, not at call
  sites**: max **1 request/sec** (IP-level; exceeding it gets the IP blocked)
  and a meaningful User-Agent built from `CARGO_PKG_NAME`/`CARGO_PKG_VERSION`
  with a contact URL.
- **Cover Art Archive** — keyed by the same release MBID, no auth. Feeds the
  existing `covers` table and the `cover://` protocol. A 404 is "no cover", not
  an error.
- **Discogs** — richer for electronic and vinyl, auth mandatory, and image URLs
  require it. Use a **personal access token** entered by the user, not OAuth
  1.0a: that would bake a consumer secret into the binary where it is not
  secret. Strictly an opt-in second source; the feature is fully useful with
  MusicBrainz alone.

Shape: `src-tauri/src/tagsource/` with a `TagSource` trait
(`search(query) -> Vec<ReleaseSummary>`, `fetch(id) -> ReleaseDetail`), one impl
per provider, over an injected HTTP transport so tests run offline. Commands
`tagsource_search` and `tagsource_fetch`.

UI mirrors Mp3tag's flow because it is the right one: search per album, pick a
result, then a **confirm dialog** mapping remote tracks to selected files (with
manual reorder) and per-field checkboxes. Never automatic, never bulk-applied
unreviewed.

Testing: recorded JSON fixtures incl. multi-disc and various-artists releases;
the rate limiter asserted to serialize concurrent calls at ≥1s; the UA header
asserted present; one `#[ignore]`d live test per provider.

Cost: nothing. Both services are free at this scale.
