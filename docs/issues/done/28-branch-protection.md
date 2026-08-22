# 28 — Server-side branch protection

Merged in #43.

GitHub gates rulesets behind Pro for *private* repositories, which the README used
to say. Making the repo public lifted that, and a `no-master-push` ruleset was
already enforcing PR-only, no force-push and no deletion — but **not** the status
checks, so a pull request with red CI could still be merged, the one thing the
whole gate exists to prevent.

All six checks (`changes`, `frontend`, `rust`, `cargo-deny`, `notices`, `e2e`) are
now required. No bypass actors, so it applies to the repository owner too.

`strict_required_status_checks_policy` is deliberately **off**: requiring every
branch to be current with `main` would re-run the full gate on every open PR each
time anything lands, and the gate costs real Actions minutes.

The `.githooks/pre-push` block on `main` stays as a fast-fail convenience. The
server is what actually refuses.
