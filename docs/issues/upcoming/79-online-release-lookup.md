# 79 — Online release lookup

Produces a candidate tag set only; phase 8's atomic writer and undo journal
apply it. Second outbound network dependency, inert unless the user asks.

**MusicBrainz**, on the evidence of what else uses it: Lidarr, Picard and beets
are all on it, and Soulseek has no metadata layer to integrate with at all.
Discogs is the secondary everyone reaches for on electronic and vinyl.

**Call the public APIs directly from Rust.** Mp3tag's `.src` DSL exists so
non-programmers can add sources without a rebuild; two typed clients are our
equivalent. That trade flips only if user-contributed sources are ever wanted.

- **MusicBrainz** — no auth. `GET /ws/2/release?query=…&fmt=json` to search,
  `GET /ws/2/release/<mbid>?inc=recordings+artist-credits+release-groups&fmt=json`
  for the tracklist. Two hard rules, both enforced **in the client, not at call
  sites**: max **1 request/sec** (IP-level; exceeding it gets the IP blocked)
  and a meaningful User-Agent built from `CARGO_PKG_NAME`/`CARGO_PKG_VERSION`
  with a contact URL. `inc` is not accepted on search, so a release costs two
  calls and there is no way to make it cost one.
- **Cover Art Archive** — keyed by the same release MBID, no auth, and
  **no rate limit**, so covers fetch in parallel while MusicBrainz is the
  bottleneck. `/release/<mbid>/front-500` is exactly what [72](../done/72-covers-are-most-of-the-database.md)
  stores. A 404 is "no cover", not an error.
- **Discogs** — richer for electronic and vinyl, auth mandatory, and image URLs
  require it. Use a **personal access token** entered by the user, not OAuth
  1.0a: that would bake a consumer secret into the binary where it is not
  secret. Strictly an opt-in second source; the feature is fully useful with
  MusicBrainz alone.
- **AcoustID** is not in this phase. It batches fingerprints at 3 req/s and
  `rusty-chromaprint` is a pure Rust port, so `unsafe_code = "forbid"` would
  survive it — but fingerprinting means decoding two minutes of every file, and
  it is the answer for what text search cannot match rather than the first pass.

**A release is the unit, not a track.** 65,535 tracks are 8,045 releases, so a
per-track lookup would pay four thousand percent over the odds. Group the
selection by `(album, coalesce(album_artist, artist))` — the same expression
`db::query` groups the browse view by — and look each group up once.

Shape: `src-tauri/src/tagsource/` with a `TagSource` trait
(`search(query) -> Vec<ReleaseSummary>`, `fetch(id) -> ReleaseDetail`), one impl
per provider, over an injected HTTP transport so tests run offline, and a rate
limiter owned by the client. Commands `tagsource_search` and `tagsource_fetch`.

**Store the release MBID** on every track it writes — `tracks.release_mbid`,
migration 11. It is what
[81](81-one-release-one-tile.md) needs and what makes a second pass idempotent;
without it the only identity a release has is its title, which collides.

UI mirrors Mp3tag's flow because it is the right one: search per release, pick a
result, then a **confirm dialog** mapping remote tracks to selected files (with
manual reorder) and per-field checkboxes.

**Score every candidate**, even here where a human confirms — [82](82-lookup-runs-itself.md)
needs the number and cannot invent it later. Track count and per-track duration
agreement against MusicBrainz's own search score; the dialog sorts by it.

Testing: recorded JSON fixtures incl. multi-disc and various-artists releases;
the rate limiter asserted to serialize concurrent calls at ≥1s; the UA header
asserted present; one `#[ignore]`d live test per provider.

Cost: nothing. Both services are free at this scale.
