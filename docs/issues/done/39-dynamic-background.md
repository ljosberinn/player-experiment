# 39 — The background that follows the music

**In review — PR #62**, branch `phase-39-dynamic-background`. Recorded here
because the work is built; the phase is not closed until that merges.

Three blurred radial blobs behind everything, taking their colours from the cover
of what is playing.

**Extraction, in Rust at cover-store time** — not in the webview: the bytes are
already in hand, it happens once per unique cover rather than once per track
change, and a `cover://` image on a canvas is a readback the webview would have to
be talked into allowing. Migration 6 appends `palette TEXT` to `covers`; no
backfill exists because the phase 32 rename gave every install a fresh directory,
and a cover from an older database simply gets a palette the next time it is seen.

**Built as a midpoint split, not median cut.** Median cut divides a box at its
median *pixel*, so an album cover that is 70% near-black — a great many of them —
spends two of its three boxes on near-black and averages everything bright into
the third: two blobs the same colour and one made of mud. Splitting at the midpoint
of the widest channel's *range* divides by colour instead. Boxes are ordered by
pixel count afterwards, so the dominant colour still comes first.
`a_cover_that_is_mostly_one_colour_does_not_spend_two_blobs_on_it` is the test that
decided it. Near-greyscale covers correctly produce near-greyscale blobs.

**Delivery** rides along with the existing player state rather than a new event —
the frontend already learns what is playing, and the colours are a property of that.

**Animation.** 7–10% opacity over the base surface, one 360° rotation per minute,
and a ~1.6s blend when the album changes so moving between records is a wash rather
than a cut. Nothing playing, or no cover, means the default scheme with no blobs.

Positions are offsets from the **window** centre (`calc(50% - 28vw)`), not
percentages: the layer has to be far larger than the window so a rotation never
swings an edge into view, and a percentage is a percentage *of the layer*. Written
the naive way first, and the third blob spent its whole life below the bottom of
the window. Two follow-up fixes were about the same class of mistake: the layer
paints above the window's fill, and the song list must not paint an opaque sheet
over it.

**Off switches, deliberately independent.** `prefers-reduced-motion: reduce` stops
the rotation and the wash and **leaves the colours** — someone who asked for no
animation has not asked for no colour. A Settings checkbox turns the whole thing
off, persisted in settings.
