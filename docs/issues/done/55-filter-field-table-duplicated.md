# 55 — The filter field/operator table was duplicated in TypeScript

`filterTree.ts` restated `FilterField::kind` and the `(kind, op)` match in
`smart::compile`. Both copies agreed when this was written; nothing kept them
agreeing, and drift only ever shows up as the editor offering a combination the
backend refuses — annoying, and unexplainable to the user who hits it.

## What the backend exports

`smart::bindings::export_bindings_filter_ops` writes
`src/ipc/bindings/filterOps.generated.ts`: `FILTER_FIELD_KINDS` (field to kind)
and `ACCEPTED_FILTER_OPS` (kind to every operator `compile_rule` takes). Named
`export_bindings_*` so `npm run bindings` regenerates it and the CI staleness
check on `src/ipc/bindings` covers it with no new step, and written to
`Config::from_env().out_dir()` so it cannot land anywhere but beside the
bindings it imports.

Variants come out of the ts-rs declaration rather than a hand-written
`const ALL`: the derive sees the enum arms, and a `const` only sees whoever last
remembered it.

A pair counts as accepted if it compiles with *any* shape of value. A refused
operator and a value of the wrong shape are both `AppError::Internal`, so trying
all four shapes asks the question the table is about without matching on error
strings.

Keyed by kind rather than by field, because `compile_rule` matches on
`(kind, op)` alone. The test asserts that instead of assuming it: every field of
a kind must accept the same set, so a rule added for one field in particular
fails at the export rather than being averaged away.

## What TypeScript keeps

`OPS_BY_KIND`, still written by hand, because it is deliberately a *subset*.
Timestamp omits `is` and `isNot` — the backend accepts them, but a timestamp is
a unix second and nobody means to match one exactly. `filterTree.test.ts`
therefore checks one direction only: every operator offered is accepted.
Narrowing further stays allowed.

Labels and dropdown order, which are UI decisions and were never the problem.

## What TypeScript lost

The per-field `kind` annotations and the hand-typed `FieldKind` union. `kindOf`
reads `FILTER_FIELD_KINDS`, and `FilterFieldKind` is exported by ts-rs like
every other shared type.

A silent failure that predates the duplication: a column added to `FilterField`
would never appear in the editor, with nothing failing anywhere. `FIELDS` is now
asserted to cover every key of `FILTER_FIELD_KINDS`.
