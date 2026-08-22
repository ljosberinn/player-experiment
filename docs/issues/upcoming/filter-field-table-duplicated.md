# The filter field/operator table is duplicated in TypeScript

`src/features/smart/filterTree.ts` mirrors `FilterField::kind` and the operator
match in `src-tauri/src/smart/compile.rs`.

Never unsafe: the backend validates every filter by compiling it before storing,
so drift shows up as the editor offering a combination the backend refuses —
annoying, and confusing to a user who cannot see why.

Generating the table from Rust would remove the duplication. `ts-rs` already
emits the types; what is missing is the *table* — which operators each field kind
accepts. Worth doing if it ever bites; not worth a phase on its own.
