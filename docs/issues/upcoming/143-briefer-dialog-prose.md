# 143 — Dialogs say it in fewer words

Shorten dialog and Settings prose to native-dialog length. Last on purpose:
the issues before it add and move strings. No contractions,
matching the rest of the UI. `{n}`, `{u}` and `{date}` are the existing
interpolations; keep the plurals they already have.

## last.fm

| Where | Now | Proposed |
| --- | --- | --- |
| `LastfmSettings.tsx:76` | {n} plays are recorded and waiting to be sent. They go out with the next song, or the next time the app starts. | {n} plays waiting to be sent. |
| `LastfmSettings.tsx:115` | Drops every imported play and fetches the history again. | Replaces every imported play. |
| `LastfmSettings.tsx:128` | Connecting sends nothing but an API key — you sign in on last.fm’s own page, in your browser. After that, each song you play sends its artist, title, album, length and the time the play started. Never the file path, the folder name, the size of your library, or anything about this machine. | You sign in on last.fm, in your browser. A play sends its artist, title, album, length and start time; a love, its artist and title. Nothing else. |
| `LastfmSettings.tsx:134` | The key granting this access is stored unencrypted in your library database. Revoke it any time from your last.fm account settings; disconnecting here only forgets it locally. | The access key is stored unencrypted. Disconnect only removes it here; revoke it in your last.fm settings. |
| `LastfmSettings.tsx:161` | Brings your scrobbles into the play log. Needs a username, not a connection. | Imports any user’s scrobbles. No connection needed. |
| `LastfmSettings.tsx:164` | The last import stopped part-way. Resume picks up where it stopped. | The last import did not finish. |
| `LastfmSettings.tsx:167` | {u} has no scrobbles to import yet. | {u} has no scrobbles yet. |
| `LastfmSettings.tsx:172` | Imported through {date}. Import again to fetch what is newer. | Imported through {date}. |
| `LastfmSettings.tsx:192` | This build carries no last.fm key, so scrobbling is unavailable. | last.fm is not available in this build. |
| `lastfm/store.ts:184` | last.fm rejected the stored key. Connect again to keep scrobbling. | last.fm rejected the key. Connect again. |
| `lastfm/store.ts:225` | last.fm was not authorised in time. Press Connect to try again. | Connecting timed out. Try again. |
| `ListeningTiles.tsx:32` | Nothing has been played yet. Import your last.fm history from Settings ▸ last.fm to bring in what came before. | Nothing has been played yet. Import your last.fm history in Settings ▸ Online. |
| `src-tauri/src/lastfm/import.rs:309` | {u} keeps their listening history private on last.fm. | {u}’s last.fm history is private. |

`ListeningTiles` also names a pane that does not exist; last.fm lives under
Online.

## Confirmations

| Where | Now | Proposed |
| --- | --- | --- |
| `App.tsx:570` (Remove missing songs?) | {n} songs cannot be found on disk. Removing them takes them out of every playlist too. The files themselves are not touched - if a drive is simply unplugged, plug it back in and rescan instead. | {n} songs cannot be found. Removing them also takes them out of every playlist. If a drive is unplugged, reconnect it and rescan instead. |
| `App.tsx:585` (Remove these songs?) | {n} songs will be taken out of your library, and out of every playlist too. The files on disk are not touched, but a rescan will not bring them back - use File ▸ Forget Removed Songs for that. | {n} songs will be removed from your library and every playlist. The files stay on disk; a rescan adds them back only after File ▸ Forget Removed Songs. |
| `LibraryFolderSettings.tsx:138` (Move your library?) | {n} songs will be moved into {path}, a few at a time in the background. Turning Organise My Library off stops it, but nothing moves back. | {n} songs will be moved into {path} in the background. Turning off Organise My Library stops it; nothing moves back. |

## Settings ▸ Library

| Where | Now | Proposed |
| --- | --- | --- |
| `LibraryFolderSettings.tsx:131` | Songs are moved into artist and album folders as the app works through them. Turning this off stops it; nothing moves back. | Moves songs into artist and album folders. Turning this off does not move them back. |
| `WatchFolderSettings.tsx:144` | Removing a folder only stops it being looked at. The songs already in your library stay until a check finds their files gone, and are then marked missing. | Removing a folder only stops watching it. Its songs are marked missing once their files are gone. |
| `WatchFolderSettings.tsx:148` | Your Library folder stays on this list until you turn off Organise My Library. | The Library folder stays while Organise My Library is on. |

## Crash notice

| Where | Now | Proposed |
| --- | --- | --- |
| `CrashNotice.tsx:75` | It stopped last time with the error below. Nothing was sent anywhere - the report is on this machine only. | The error is below. The report stays on this computer. |

## Get Tags from MusicBrainz

| Where | Now | Proposed |
| --- | --- | --- |
| `ReleaseLookup.tsx:167` (Set Aside tooltip) | Take this release out of the review queue | Remove from the review queue |
| `ReleaseLookup.tsx:424` | The release identifiers are written to every song of this release; the ticked fields to the {n} mapped above. | IDs are written to every song; ticked fields to the {n} mapped. |
| `ReleaseLookup.tsx:490` | MusicBrainz has nothing under that album and artist. Take another release out of the queue, or edit the tags by hand and search again. | No match on MusicBrainz. Fix the album or artist and search again. |

## Tag editor and smart playlist editor

| Where | Now | Proposed |
| --- | --- | --- |
| `TagEditor.tsx:237` | Only the fields you change are written; the rest are left as they are. | Only changed fields are written. |
| `SmartPlaylistEditor.tsx:166` | No conditions yet — this playlist will hold your whole library. | No conditions — includes your whole library. |

## Notices

| Where | Now | Proposed |
| --- | --- | --- |
| `library/scan.ts:46` | That file is not in a watched folder. Turn on Organise My Library in Settings, or drop the folder it is in. | That file is not in a watched folder. Drop its folder instead, or turn on Organise My Library. |
| `library/scan.ts:47` | Those {n} files are not in a watched folder. Turn on Organise My Library in Settings, or drop the folders they are in. | Those {n} files are not in a watched folder. Drop their folders instead, or turn on Organise My Library. |

## Tests

Tests do not pin wording. Where one asserts prose, query by role or label
instead, or delete the assertion when the prose was all it checked — including
the privacy-list assertion at `LastfmSettings.test.tsx:76` and its comment.
Affected: `LastfmSettings.test.tsx`, `lastfm/store.test.ts`,
`SmartPlaylistEditor.test.tsx`, `App.test.tsx`, `WatchFolderSettings.test.tsx`,
`ReleaseLookup.test.tsx`, e2e `row-menu.test.ts`, Rust `lastfm/import.rs`.

Screenshots that change: `settings-lastfm-import`, `settings-library-folder`,
`settings-library-folder-unset`, `remove-from-library`, `crash-notice`,
`crash-notice-expanded`, `library-drop-refused`.

## Verification

- Every string in the tables reads as proposed in the running app.
- Settings ▸ Online still says what a play and a love send, and that the key
  is stored unencrypted.
- No test asserts a sentence of prose.
