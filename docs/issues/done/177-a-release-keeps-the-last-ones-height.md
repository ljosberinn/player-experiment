# 177 — A release keeps the last one's height

Moving from one drill-in to another with the same number of releases can leave
a 2px rule across a row: *Tanzlabor* (17 tracks) drawn with a rule through
track 16, which is where a 14-track group ends.

The rule is `.release-group`'s `border-bottom`, and the section's height is the
virtualizer's `item.size`. TanStack Virtual memoizes its measurements on
`count`, `getItemKey` and a few options (`getMeasurementOptions`,
`virtual-core/src/index.ts`), never on `estimateSize`. With the count
unchanged, the next drill-in keeps the old groups' sizes and offsets: rows run
past their section's rule, and with several releases the groups overlap.

Grid to drill-in is fine: `releases` goes from empty to full, so the count
changes.

## Fix

A `getItemKey` of `releases[i].id`, memoized on `releases`: a new list is a new
key function, which lays the groups out again in the same render. `measure()`
in an effect would cost a second render.

## Verification

- `ReleaseGroups` test: swap `releases` for a list of the same length with
  other track counts; each section's height and offset follow the new counts.
