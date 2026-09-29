# Tests

How the De-Identifier's detection, speed and web behavior are measured. Every
record here is fictional: the tuning and held-out records are synthetic (built
by `make-testfiles.cjs` from their answer keys), and the Roberts IEP is the
review team's fictional training model. No real student data goes in here,
ever. Current results are in STATUS.md under "Where things stand now".

## What is here

- `keys/` holds the answer keys. Each record lists its identifiers, its
  quasi-identifiers and the terms that must stay readable. `tuning.json` has 5
  records, `heldout.json` has 5 more (never write rules against these; they
  check that rules generalize), and `roberts.json` has the Roberts IEP.
- `files/` holds the same records as Word files, one folder per set, each
  with a `manifest.json`. `files/tuning/` also has a scanned PDF (OCR) and
  `Hunter Mullins IEP draft.docx`, which hides a name in every Word part the
  v51 and v57 fixes clean (it is not graded, only checked by eye).
- `rule-cases.json` holds short regression sentences for the rules added in
  v67–v72, each with what must stay readable and what must scrub.

## Start the dev desktop app

Assemble `desktop/webapp/` the way the build workflow does (copy `deid`,
`icons`, `models`, `vendor` and the top-level app files into it), then:

```bash
cd desktop && npx electron . --remote-debugging-port=9334 --user-data-dir="$TEMP/deid-dev"
```

The separate profile lets it run beside an installed copy.

## The checks that decide whether a change ships

| Command | What it does | Time |
|---|---|---|
| `node tests/rule-cases.mjs` | runs every sentence in `rule-cases.json`, prints PASS/FAIL | ~1 min |
| `node tests/bench.mjs 9334 <label> tests/results/<label>.json` | all 11 records in one batch: deep-check seconds per record, every deep span, graded under desktop and web behavior | ~11 min |
| `node tests/compare.mjs <before.json> <after.json>` | times, graded totals, and exactly what changed: new leaks, name pieces left, quasi-identifiers, readable terms, deep spans | seconds |
| `node tests/same-findings.mjs <before.json> <after.json>` | finding-by-finding diff, to tell real changes from tag renumbering | seconds |

A change ships only if, under both behaviors, it adds no leak, removes no
quasi-identifier and loses no readable term. `tests/results/` is not
committed.

## Web behavior (service worker, isolation, iframes, offline)

- `node tests/webserve.mjs 8140` serves the repo the way GitHub Pages does:
  under `/paper-scrubber/`, with `max-age=600` and no COOP/COEP headers.
  `/sw.js=<file>` serves an older service worker. In Git Bash, set
  `MSYS_NO_PATHCONV=1` for arguments that start with "/".
- Point a headless Edge at it (`--remote-debugging-port=9335` with its own
  `--user-data-dir`), then run `bench.mjs 9335 <label> <out> --soft`. A hard
  reload skips the service worker, so the web tests reload normally.
- `coi-check.mjs` shows isolation turning on after the worker takes over;
  `update-over-papers.mjs` confirms an update never reloads over an open
  paper; `threads.mjs` lists the thread workers inside the deep-check worker;
  `console-log.mjs` tallies console errors (look for `worker sent an error!`).
- Iframes: `node tests/embed-serve.mjs` serves `embed-parent.html` on
  127.0.0.1:8141, and `iframe-scrub.mjs` scrubs inside both embedded tools.
- `node tests/offline-test.mjs fresh` (or `upgrade`) starts its own server and
  Edge, deep-checks online, simulates a deploy, shuts the server and checks
  the deep check still runs, threaded and in an iframe.

## Desktop program

`link-test.mjs` and `dl-test.mjs` need Electron started with `--inspect=9229`.
They replace `shell.openExternal` in the main process with a logger, and they
refuse to click anything unless that replacement took.

## Other tools

`drop-file.mjs` (one file through the tool, e.g. the scanned PDF),
`quick-scrub.mjs`, `peek.mjs` (progress of a running batch),
`profile-deep.mjs` (CPU profile of the deep-check worker), `spans-csv.mjs`
(every deep span of a run as CSV), `frames.mjs`, `print-pdf.mjs` (the
handout PDF), and `make-testfiles.cjs` (rebuilds the synthetic Word files from
a key: `node tests/make-testfiles.cjs tests/keys/tuning.json tests/files/tuning`).
