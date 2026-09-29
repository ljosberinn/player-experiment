# 182 — An untagged release is not looked up

A release with neither album nor artist fails `lookup.release` on every sweep
(`These songs name neither an album nor an artist…`, `failed=1`): the search
refuses it, and a failed lookup keeps no `release_lookup` row, so the next
sweep has it back.

## Fix

`pass::look_up` answers such a release with no candidates, without a search,
so it is recorded as `none` like any other miss and then placed.

## Verification

- `pass` test: an untagged release is `NotFound`, recorded `none`, and nothing
  is sent.
- After a sweep, no `err lookup.release album=- artist=-` line, and the next
  `pass.sweep` has `failed=0`.
