# Rename the repository

The product is Apex; the repository is still `ljosberinn/player-experiment`. It
was deliberately left out of the rename in phase 32.

Renaming breaks, in this order of annoyance:

- the `origin` remote on every clone;
- the `ci/screenshots` branch, which pull request bodies point at by **raw URL**
  — every merged PR's images;
- links in merged pull requests generally.

GitHub redirects the repository itself, so the cost is the raw URLs. Self-
contained, and can happen whenever it is wanted.
