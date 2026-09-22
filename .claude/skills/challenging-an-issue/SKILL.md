---
name: challenging-an-issue
description: Use when picking up an issue doc from docs/issues/ to work on, before writing code, editing the doc, or agreeing to its plan.
---

# Challenging an Issue

## Overview

An issue doc is a hypothesis someone wrote from memory of the codebase. Its
prose is confident; its facts are unverified. Every claim it makes about this
repo is unproven until a file says otherwise.

**Implementing an issue's plan without checking its claims is implementing
someone's memory of the code rather than the code.**

## The rule

Before the first edit: open every file the issue names, check every claim in
the table below, report the challenges with citations, and get a decision on
any that change scope.

## Claims worth checking

| Claim shape | How it fails | Check |
|---|---|---|
| "It lives in X, beside Y" | Y is in another module — and Y's module is the right home | Open X. Is Y actually there? |
| "Reuse the route Z already has" | Z is not where the issue thinks it is | Find Z's definition |
| "This component / this view" | A sibling renders the same thing off the same state | Grep the component and the hook for every consumer |
| "Rare", "unlikely", "N makes this safe" | The bound only holds in the common case | Build the counterexample. If you can, it is not rare |
| "`await f()` means the thing happened" | `f` returns early on a path the issue did not read | Read `f` |
| "No new CSS", "nothing else breaks" | A claim about the whole repo, made from one file | Grep |
| "Only the X keeps the special value" | The case where there is no X | Ask what happens when it is absent |

## A challenge is a citation, not an opinion

Each one names the issue's claim, the `file:line` that contradicts it, and what
breaks if it ships as written. Three sentences.

> Issue: "*`SongTable`'s window keydown effect, beside the row-menu route.*"
> The row-menu route is in `useSongTableWiring.ts:147`, not `SongTable`.
> `ReleaseGroups` uses the same wiring, so scoping to `SongTable` means the
> keyboard dies the moment you drill into an album.

"This seems off" is not a challenge. Neither is a correction with no consequence
attached — if nothing breaks, it is a nitpick, and nitpicks go in the rewrite
silently.

## Stop where the correction changes scope

A wrong fact you fix yourself. A correction that changes **what gets built** —
a second view now in scope, a key removed with no replacement, a rule that
spans components the issue never mentioned — is the user's call. Put the
options and their costs to them before you design around your own answer. Two
options with a stated recommendation beats a survey.

Watch for corrections that conflict with each other once stated plainly. If the
user's answer asks for two things the platform cannot both do, say which two
and why, rather than picking one quietly.

## Then rewrite the doc, don't annotate it

The issue becomes the record of what was built: the repo's voice, the corrected
facts, the decisions taken and the ones deferred. No changelog of what the
draft got wrong, no "originally this said". Move it to `docs/issues/done/`.

## Red flags

- "The issue already says where it goes" — it says where the author remembered
- "I'll note the discrepancy in the PR description" — note it before you build on it
- "It's only a doc; the code is what matters" — you are about to implement the doc
- "I read the main file" — the claims that fail are about its neighbours
- "The author knows this codebase better than I do" — they also wrote it from memory
- Any edit landing before the first named file is open
