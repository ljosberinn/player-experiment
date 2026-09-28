# 174 — Add to Playlist greys out with no playlist

With no static playlist, the row menu's *Add to Playlist* opens a submenu that
reads *No playlists yet*. Disable the entry instead (`rowMenuItems`, so the Edit
menu follows). Smart playlists still don't count.

The empty-submenu branch in `renderMenuItem` (`ContextMenu.tsx`) then has no
caller: remove it, `.menu-empty`, and its test. The `UI/ContextMenu` story's
untagged song shows the greyed entry.

## Verification

- No playlists, or only smart ones: *Add to Playlist* is greyed in the row menu
  and in Edit.
- One static playlist: the entry opens onto it.
