# 36 — The sidebar sections

Merged in #56.

- **Collapsible.** SMART PLAYLISTS and PLAYLISTS each collapse to their heading,
  persisted in `settings` per section. LIBRARY does not collapse — four items that
  are the primary navigation.
- **Counts on every playlist.** Static ones already had them, and smart ones
  already reported a `track_count` (`db::playlists::list` runs `count_tracks` with
  the compiled filter), so the work was not computing but **recomputing**: on
  `library://changed`, debounced 250ms, because a scan emits that event far more
  often than a human can read a number. One reload of the playlist list, not one
  query per playlist per event.

**The built-in playlists were planned here and moved to 37.** Both are a sort plus
a cutoff, and neither existed until that phase built them; special-casing two
playlists for one phase and then unpicking it was the alternative.
