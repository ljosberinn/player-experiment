# 112 — Storybook on GitHub Pages

The component library exists but only on a laptop that ran `npm run storybook`.
Publish it, so a primitive in every state on both grounds is a link.

Free: the repository is public, and GitHub Pages is free for public
repositories. No Chromatic, no Netlify, no account beyond the one that already
owns the repo.

## The workflow

`.github/workflows/storybook.yml`, separate from `ci.yml` rather than a job in
it — `ci.yml` runs on pull requests as a required gate, and this runs on pushes
to `main` only. Nothing about a deployment belongs in the gate.

- `permissions: { pages: write, id-token: write, contents: read }` on the job.
- `concurrency: { group: pages, cancel-in-progress: false }`. Not the
  workflow-level group `ci.yml` uses: cancelling a half-finished deployment is
  the one case where the newer run should queue instead.
- `actions/checkout`, `actions/setup-node` at node 24 with `cache: npm`,
  `npm ci`, `npm run build-storybook`, then `actions/upload-pages-artifact` with
  `path: storybook-static` and `actions/deploy-pages`. Take the current major of
  each; Dependabot keeps them current afterwards.
- `environment: { name: github-pages, url: ${{ steps.deploy.outputs.page_url }} }`
  so the URL shows on the run rather than having to be remembered.

One-time and outside the repository: **Settings → Pages → Source = GitHub
Actions**. Without it the deploy step fails with "Pages is not enabled". Do it
before the first merge, not after the first red run.

## No base path

`ljosberinn.github.io/player-experiment/` is a subfolder, which usually means a
Vite `base`. Not here: `@storybook/builder-vite` hard-codes `base: "./"` in its
common config, explicitly for subfolder deploys
([builder-vite#238](https://github.com/storybookjs/builder-vite/issues/238)),
and it sets it *after* merging `vite.config.ts`, so nothing in this repo can
override it by accident. Confirm on the first deploy and then leave it alone.

## What stays

The `Storybook build` step on `ci.yml`'s `frontend` job stays. It is the branch
gate — a story that does not compile has to fail on the pull request that wrote
it, not on `main` after the merge. The duplicate build costs one runner minute
per merge, which is the cheaper half of the trade.

## Docs

- A section in [ci-and-release.md](../../knowledge/ci-and-release.md), beside
  the gate, saying what publishes and where the one manual setting lives.
- The URL in `README.md`.

Independent of the rest of the sequence. Its own worktree.

Part of the [component library sweep](../../plans/apex-components.md).
