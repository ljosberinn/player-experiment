# 98 — A sole match needs no second opinion

The unattended pass writes a release only above `UNATTENDED_THRESHOLD`, and the
score it checks is the *fetched* one, which assumes a perfect text match and
spends its weight on the per-track durations. A release with the right number
of tracks and no durations in common — MusicBrainz has none, or the rip is a
different master — lands at 0.70 and goes to the review queue, where the person
reviewing it is offered a list of one.

The pass also writes a release when all three hold:

- the fetched tracklist is the same length as the release on disk,
- the search came back with exactly one candidate,
- that candidate's *search* score is at or above `UNATTENDED_THRESHOLD`.

The search score is the half the fetched score throws away: MusicBrainz's own
text agreement, with no durations in it. One candidate means there is no second
pressing for the durations to tell apart, which is the only thing they are
there for.

The track count still guards both paths. Ten files against an eleven-track lone
candidate scores 0.96 on the search, and the write maps tracks onto files by
position.

## Changes

- `pass::look_up`: `confident` is `counts_agree && (scored_well || sole)`, with
  `sole` requiring `!scored_well`, `candidates.len() == 1` and
  `best.score >= UNATTENDED_THRESHOLD`.
- `Verdict::Written` gains `sole: bool`; `worker::outcome_fields` logs
  `sole=true` only when it is. Without it the line's `score` is a
  sub-threshold write and a tuning pass reads a broken bar.

Testing: Rust — a lone candidate of the right length written though its
durations disagree and flagged `sole`; one the text barely matches queued; one
of a different length queued; a write that cleared the bar on its own score not
flagged. The existing three-candidate fixture already pins that more than one
candidate leaves the durations deciding.
