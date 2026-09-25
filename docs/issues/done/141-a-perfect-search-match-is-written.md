# 141 — A perfect search match is written without review

If the pass's best candidate has a search score of exactly 1.0, meaning a full
text match and the same track count as the files, the pass writes it even when
the fetched score is under `UNATTENDED_THRESHOLD` and other candidates exist.

The search score is `0.6 * text + 0.4 * count`
([score.rs:62](../../../src-tauri/src/tagsource/score.rs#L62)), so only a
perfect text match with an equal track count reaches 1.0. Compared by equality,
not `>=` a float threshold that a 99-point text match could also clear.

## Guard: the lengths must not contradict it

The write maps by position. Seven Bells (Secrets of the Moon) scores 1.0 on the
search: 8 files against 8 tracks. Locally, though, the DVD's "Nyx (Video edit)"
sorts as the second track 6, while MusicBrainz lists it as disc 2 track 1. With
no guard, "Nyx" would be written onto the video edit file and every later title
would land on the wrong file.

Rule: the pass writes unless some pair of known lengths differs by
`TOLERANCE_MS` (30 s) or more. A length MusicBrainz lacks counts as no evidence.
`score::lengths_contradict` checks the same positional pairs
`duration_agreement` averages.

`Verdict::Written` carries a `Reason` (`Scored`, `Sole`, `Perfect`); the log
writes `reason=sole` or `reason=perfect`, nothing for `Scored`. `Sole` takes
precedence where both apply.

## Tests

In `pass.rs`:
- Three candidates, search 1.0, lengths off by 3–20 s: written, `Perfect`.
- Same, with one pair 60 s off: queued.
- Text 98 (search 0.988): queued.

## Verification

- After a sweep, Seven Bells stays in the queue.
- Releases that match text and count and whose lengths drift under 30 s leave
  the queue.
