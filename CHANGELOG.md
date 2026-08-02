# Changelog

## [0.2.0](https://github.com/ljosberinn/player-experiment/compare/v0.1.0...v0.2.0) (2026-08-02)


### Features

* **audio:** playback engine, transport and play counts ([#5](https://github.com/ljosberinn/player-experiment/issues/5)) ([eb24e87](https://github.com/ljosberinn/player-experiment/commit/eb24e87766b0d8c6ce099c5bb75a914af7e9a8a4))
* **export:** JSON export against a documented schema, and window geometry ([#11](https://github.com/ljosberinn/player-experiment/issues/11)) ([b26feae](https://github.com/ljosberinn/player-experiment/commit/b26feae679b91e57bc3ccb0e796740a7948a599f))
* **library:** real totals in the footer ([#15](https://github.com/ljosberinn/player-experiment/issues/15)) ([e079457](https://github.com/ljosberinn/player-experiment/commit/e079457eb91f944fbb6ae4d99394b19510dda5e7))
* **library:** SQLite schema, incremental scan and paged queries ([#2](https://github.com/ljosberinn/player-experiment/issues/2)) ([571b5c7](https://github.com/ljosberinn/player-experiment/commit/571b5c7d793adb674ab67f0d22cbcfc1464cbe80))
* **playlists:** static playlists with drag-and-drop and reordering ([#8](https://github.com/ljosberinn/player-experiment/issues/8)) ([8f10a3d](https://github.com/ljosberinn/player-experiment/commit/8f10a3dc411d6a43ed5f9d1c9a387a9919c1b73a))
* scaffold Tauri v2 + React app with full CI gate ([#1](https://github.com/ljosberinn/player-experiment/issues/1)) ([75dd29c](https://github.com/ljosberinn/player-experiment/commit/75dd29c2655771703ac222bfd50e538d6d708454))
* **search:** debounce the search box and rank results by relevance ([#6](https://github.com/ljosberinn/player-experiment/issues/6)) ([843cbcf](https://github.com/ljosberinn/player-experiment/commit/843cbcfd4dd669fda1162767fa10201a7dc4278a))
* **smart:** smart playlists with a compiled filter tree ([#9](https://github.com/ljosberinn/player-experiment/issues/9)) ([c067f57](https://github.com/ljosberinn/player-experiment/commit/c067f5796ac2b8ace2491ab2540f608b35d034f3))
* **tags:** single and bulk tag editing with an undo journal ([#10](https://github.com/ljosberinn/player-experiment/issues/10)) ([571a4c2](https://github.com/ljosberinn/player-experiment/commit/571a4c2bce2774df7a7fb67bb3bb8a44391cacf8))
* **ui:** interaction polish from the fifth build ([#19](https://github.com/ljosberinn/player-experiment/issues/19)) ([4f7c5f6](https://github.com/ljosberinn/player-experiment/commit/4f7c5f67a41a2f760e6f9f3d6bc6fc1a88f1ded9))
* **ui:** iTunes-style shell with a virtualized songs table ([#3](https://github.com/ljosberinn/player-experiment/issues/3)) ([423d029](https://github.com/ljosberinn/player-experiment/commit/423d029de021f477a7ba8c2f8cff365078bb2911))
* **ui:** native feel pass ([#14](https://github.com/ljosberinn/player-experiment/issues/14)) ([daae2cf](https://github.com/ljosberinn/player-experiment/commit/daae2cf65f751090743273696994eca7d06053d1))
* **ui:** right-click menus on songs and playlists ([#13](https://github.com/ljosberinn/player-experiment/issues/13)) ([8caf601](https://github.com/ljosberinn/player-experiment/commit/8caf6010304c6a9cf2d54f7e45403eb40dbe6f96))
* **ui:** show the app version in the footer ([#21](https://github.com/ljosberinn/player-experiment/issues/21)) ([32b2b1a](https://github.com/ljosberinn/player-experiment/commit/32b2b1a567786c0ba4fc0d776c155d5106d8edd6))
* **updater:** download in the background, offer the restart ([#23](https://github.com/ljosberinn/player-experiment/issues/23)) ([94b3278](https://github.com/ljosberinn/player-experiment/commit/94b3278108958f29f3b5b4b27b99dcddb038baa6))


### Bug Fixes

* **ci:** stop release PRs failing the formatter ([#26](https://github.com/ljosberinn/player-experiment/issues/26)) ([ba7b35f](https://github.com/ljosberinn/player-experiment/commit/ba7b35f36503aa78b7a481d61dc5d9f7dc1aa475))
* **shell:** drop a dynamic import that could never split ([#16](https://github.com/ljosberinn/player-experiment/issues/16)) ([3f7885c](https://github.com/ljosberinn/player-experiment/commit/3f7885c62ee10d27574e2459b962910b8eea1b0d))
* **shell:** reveal the right folder, and stop the startup flash ([#17](https://github.com/ljosberinn/player-experiment/issues/17)) ([8016ddd](https://github.com/ljosberinn/player-experiment/commit/8016ddd5e35e2eef8bd76031f6f544713a50ea0c))
* **table:** refetch when the query changes but the row count does not ([#7](https://github.com/ljosberinn/player-experiment/issues/7)) ([4014415](https://github.com/ljosberinn/player-experiment/commit/401441594d8e8abf57fecb74b002b35bd103c229))
* **ui:** make drag and drop, select-all, rename and dialog keys actually work ([#12](https://github.com/ljosberinn/player-experiment/issues/12)) ([4af8c9f](https://github.com/ljosberinn/player-experiment/commit/4af8c9f587fb86760bd317cb9e8fab34f04b08dc))


### Performance

* **e2e:** stop every WebDriver command stalling for five seconds ([#24](https://github.com/ljosberinn/player-experiment/issues/24)) ([51ede3e](https://github.com/ljosberinn/player-experiment/commit/51ede3edf19571c036099f588e0d23f427ed647b))


### Documentation

* record phase 1-3 progress and known gaps ([#4](https://github.com/ljosberinn/player-experiment/issues/4)) ([4efae2d](https://github.com/ljosberinn/player-experiment/commit/4efae2d1248180e5fc365ee63663a62f24691212))
