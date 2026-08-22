# 35 — The transport strip and sidebar navigation

Merged in #55.

A 78px strip below the title bar: the prev/play/next pill, the playhead with
elapsed and total, cover art and track text, volume, search. The title bar keeps
its drag and double-click-to-maximize behaviour and loses its passengers.

- The sidebar gained the LIBRARY section — Songs, Albums, Artists, Genres, plus the
  dimmed **Statistics** placeholder the design draws, which says so until something
  gives it a job. The store already drove these four views; only the control
  changed.
- The playing row keeps the phase 16 status cell as the **only** indicator: the
  design's accent left border was removed in the same amendment that fixed the
  contrast, so there is no second marker to reconcile. Sort indicators stay in the
  headers.
- **The Songs view has no title header** — Albums, Artists and Genres keep the
  heading and its accent underline. The view with 150k rows in it is the one that
  can least afford a third of the fold on the word "Songs".
- What that heading carried ("22 songs, 2 hr 6 min") moved into the 27px status bar
  built in phase 9, which was already in that position with zoom left and version
  right. The design and the app had converged independently, so this was a restyle
  — and the summary became **view-scoped** rather than library-wide.
