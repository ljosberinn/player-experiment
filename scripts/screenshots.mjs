// Puts the e2e screenshots *in* the pull request, rather than in a zip nobody
// opens.
//
// There is no public API for the thing a human does by dragging an image into
// the comment box: that upload goes to GitHub's own asset host through an
// endpoint that needs a web session, and nothing in the REST API replaces it.
// A markdown body can only embed an image it can fetch by URL, and a build
// artifact is a zip behind an authenticated download.
//
// So the images go to a branch that exists only to hold them, and the body
// points at raw URLs pinned to that commit. Nothing lands in `main`, nothing
// appears in the diff, and the pull request shows the pictures. The branch is
// disposable: deleting it breaks the images in old bodies and nothing else,
// and any e2e run recreates it.
//
// Run by CI. Does nothing outside a pull request, and nothing if no screenshot
// was captured.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const shotsDir = join(repoRoot, "e2e", "screenshots");
const BRANCH = "ci/screenshots";
const START = "<!-- screenshots -->";
const END = "<!-- /screenshots -->";

/** Runs a command, inheriting stderr so a failure is legible in the log. */
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN || !PR_NUMBER) {
  fail("GITHUB_REPOSITORY, GITHUB_TOKEN and PR_NUMBER are all required.");
}

const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir)
      .filter((name) => name.endsWith(".png"))
      // Sorted, so the body does not reshuffle itself between runs for no
      // reason and produce a diff nobody asked for.
      .sort()
  : [];

if (shots.length === 0) {
  console.log("No screenshots were captured; leaving the body alone.");
  process.exit(0);
}

const remote = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`;
// One directory per pull request, replaced wholesale: a PR that changes what
// it looks like should not leave the old pictures behind. Because each run only
// ever writes its own folder, two runs landing at once do not actually disagree
// about anything - see the retry below.
const folder = `pr-${PR_NUMBER}`;

/**
 * Writes this run's screenshots onto the branch and pushes, once.
 *
 * A checkout of its own, so nothing here can disturb the one the tests ran
 * against - and a *fresh* one per attempt, so a retry starts from whatever the
 * branch holds now rather than from the tip this run first saw.
 */
function publish() {
  const work = mkdtempSync(join(tmpdir(), "shots-"));
  const git = (...args) => run("git", ["-C", work, ...args]);

  git("init", "-q", ".");
  git("remote", "add", "origin", remote);
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");

  // Fetched if the branch is there, started fresh if it is not.
  let existing = true;
  try {
    git("fetch", "-q", "--depth", "1", "origin", BRANCH);
  } catch {
    existing = false;
  }
  if (existing) {
    git("checkout", "-q", "FETCH_HEAD");
  }
  git("checkout", "-q", "-b", BRANCH);

  rmSync(join(work, folder), { recursive: true, force: true });
  mkdirSync(join(work, folder), { recursive: true });
  for (const shot of shots) {
    copyFileSync(join(shotsDir, shot), join(work, folder, shot));
  }

  git("add", "-A");
  const dirty = git("status", "--porcelain");
  if (dirty !== "") {
    git("commit", "-q", "-m", `ci: screenshots for #${PR_NUMBER}`);
    git("push", "-q", "origin", BRANCH);
  } else {
    console.log("The screenshots are unchanged; reusing the commit that holds them.");
  }
  return { sha: git("rev-parse", "HEAD"), work };
}

/**
 * Pushes, and tries again if another run got there first.
 *
 * Every pull request's e2e job writes to this one branch, so two of them
 * finishing together is not unusual - it is what happens whenever a stack is
 * pushed. The loser's push is rejected because the ref moved under it, and the
 * only thing wrong is the starting point: the two runs write different folders
 * and cannot actually conflict. Re-fetching and re-applying is the whole fix.
 *
 * This failed a run for real: #55 and #56 finished within a minute of each
 * other, the tests all passed, and the job went red on `cannot lock ref`.
 */
function publishWithRetry(attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return publish();
    } catch (cause) {
      if (attempt >= attempts) {
        throw cause;
      }
      // Worded for what is known rather than for the likely cause: the push
      // failed and stderr has already said why, immediately above this line.
      console.log(`Attempt ${attempt} to publish to ${BRANCH} failed; refetching and retrying.`);
      // A moment, and a growing one, so a burst of runs does not retry in
      // lockstep. Synchronous because everything around it is.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 1500);
    }
  }
}

const { sha, work } = publishWithRetry();

const raw = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${sha}/${folder}`;
const section = [
  START,
  "## What it looks like",
  "",
  "Taken by the e2e suite on the runner, from a real run. Rewritten by CI on every push,",
  "so it is always this branch rather than whatever was true when the description was typed.",
  "",
  ...shots.flatMap((shot) => {
    const name = basename(shot, ".png");
    return [`**${name}**`, "", `![${name}](${raw}/${shot})`, ""];
  }),
  END,
].join("\n");

const bodyFile = join(work, "body.md");
writeFileSync(bodyFile, run("gh", ["pr", "view", PR_NUMBER, "--json", "body", "--jq", ".body"]));

const body = readFileSync(bodyFile, "utf8");
// Replaced between markers rather than appended, so this is idempotent across
// pushes and cannot fight a human editing the rest of the body.
const marked = new RegExp(`${START}[\\s\\S]*?${END}`);
writeFileSync(
  bodyFile,
  marked.test(body) ? body.replace(marked, section) : `${body.trimEnd()}\n\n${section}\n`,
);

run("gh", ["pr", "edit", PR_NUMBER, "--body-file", bodyFile]);
console.log(`Put ${shots.length} screenshot(s) in the body of #${PR_NUMBER}.`);
