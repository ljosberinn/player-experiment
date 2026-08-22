# 11 — Crash and error reporting — **cut**

Cut 2026-08-04, after the dependencies were added and built to check the cost.

Sentry meant continuously sending data off a machine from an application whose
premise is that it does not use the network — and what it would have carried was
file paths, folder names and track titles, which is why the plan had a whole
scrubbing section. The dependency cost turned out not to be the argument
(`reqwest` already ships via the updater); what it would *send* was.

The failure class was real and stayed real, so phase 29 covered it locally with
`std::panic::set_hook` and a bounded log beside the database — no network, no DSN,
no opt-in toggle to design, nothing to scrub.
