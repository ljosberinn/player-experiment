---
name: challenging-an-issue
description: Use when picking up an issue, ticket, spec, or plan to implement — before writing code or agreeing to its approach.
---

# Challenging a Spec

A spec is written from memory of the codebase. Treat every claim about the code
as unverified until you've checked it. Otherwise you implement the author's
memory, not the code.

## Before the first edit

Verify every claim the plan depends on. Common failures:

| Claim type                           | Check                                               |
| ------------------------------------ | --------------------------------------------------- |
| Location ("it's in X, next to Y")    | Open X. Is Y there?                                 |
| Reuse ("use the existing Z")         | Find Z's actual definition                          |
| Scope ("only this module/view")      | Search for every consumer of the same code or state |
| Likelihood ("rare", "can't happen")  | Try to build the counterexample                     |
| Behaviour ("after `f()`, X is true") | Read `f`, including early returns                   |
| Repo-wide ("nothing else breaks")    | Search, don't infer from one file                   |
| Special cases ("only X keeps …")     | Ask what happens when X is absent                   |

## Report challenges as evidence

Each challenge takes three sentences: the claim, the `file:line` that contradicts
it, and what breaks if it ships as written. If nothing breaks, fix it silently.

## Escalate scope changes

Fix wrong facts yourself. If a correction changes _what gets built_, stop and
give the user two options with costs and a recommendation. Flag corrections that
conflict with each other; don't quietly pick one.

## Afterwards

Update the spec to describe what was actually built, per your team's convention.
No changelog of what the draft got wrong.

## Red flags

- "The spec already says where it goes." It says where the author remembered.
- "I'll mention it in the PR." Mention it before you build on it.
- Any edit before the files the plan depends on are open.
