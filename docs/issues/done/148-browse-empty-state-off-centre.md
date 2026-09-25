# 148 — The browse views' empty state is off centre

`BrowseView`'s "No songs yet" / "No results for …" sits at the top left of the
pane. `.empty-state` centres through `margin: auto`, which works for `App`'s
own empty states because `.content` is a flex column; `BrowseView` wraps its
paragraph in `.song-body`, which is not.

## Verification

- Releases, Artists and Genres with a search that matches nothing: the line
  sits where Songs puts its own, centred in the pane.
