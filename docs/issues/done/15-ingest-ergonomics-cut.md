# 15 — Folder drag-and-drop ingest — **cut**

Cut 2026-08-02, the user's call: *"while I explicitly asked for folder drag/drop
ingest, I later also said that it has to go if that's what prevents us from
having playlist drag and drop."*

`onDragDropEvent` only fires while `dragDropEnabled` is **true**, and while it is
true the webview hands OS drag events to the native handler instead of the page —
which is exactly what stopped phase 6's in-app dragging from working. The two
cannot both be on, and Tauri v2 has no runtime toggle
(`set_drag_drop_enabled` does not exist). The daily gesture beat the occasional
one: **the flag stays `false`** and the OS-file route is abandoned.

The recommended alternative — turn the flag on and replace in-app dragging with
the context menu plus a keyboard route — was rejected: it keeps both capabilities
only by replacing a direct gesture with a menu.

Revisit only if Tauri gains a runtime toggle. The picker route
("Add Folder…") is what ships.
