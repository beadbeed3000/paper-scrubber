# Paper Scrubber — status and to-do

Working notes so this project can be picked up from any machine. The README
covers what the tool is and how it works; this file covers where the work
stands. Last updated 5 October 2026, live version `paper-scrubber-v80`,
desktop 1.4.2.

## Where things stand now (5 October 2026)

- **Live:** web `paper-scrubber-v80`; desktop 1.4.2 on Electron 43, for
  Apple Silicon Macs on macOS 12 or newer (ad-hoc signed) and Windows
  (unsigned). All three CI release gates pass: boot, a real scrub, and the
  30 rule cases.
- **Size:** the deep model is 386 MB (was 553), its vocabulary cut to the
  Latin alphabet with identical output on English text; the De-Identifier's
  first-use download is about 500 MB. Details in v74.
- **Speed:** the deep check is about 3x faster than v64 (the Roberts model IEP
  went from 398 s to 129 s on an 8-core desktop). It uses WebAssembly threads
  in the desktop program and on the De-Identifier's own web page, from the
  second visit. Details in v65.
- **Detection, answer-keyed, desktop behavior.** Two blind measurements on
  records the rules had never seen: about 89 in 100 identifiers removed on
  the fresh set (v76) and about 97 in 100 on the fresh2 set (v80, before its
  misses were read). No full name got through either time. fresh2 was the
  easier set (v79 already removed 97 in 100 there), so 89 stays the
  conservative figure. Since v80, on the sets the rules have now seen: fresh
  11 of 356 through (9 in fact, see v80), fresh2 0 of 322, the old sets 1 of
  744. Quasi-identifiers removed: tuning 66 of 102, held-out 52 of 75, fresh
  47 of 68, fresh2 42 of 69. Readable terms kept: Roberts 40 of 50 (all 50
  on the web), tuning 47 of 50, held-out 45 of 60, fresh 49 of 72, fresh2
  58 of 70.
- **The Roberts review list is closed** (v67–v72). The desktop-only
  replacements of context hits (82 in Roberts when counted at v65: subjects,
  supports, the IQ score) are the known cost of Alex's scrub-everything
  decision, not an open item.
- **Handout:** states the Mac Privacy & Security steps, the measured time, and
  the fresh-set rate: every full name and about 89 of every 100 identifiers
  on records the tool had never seen (conservative since v80). Step 3 tells
  reviewers it misses initials and dates most often, which v80 cut back. The Mac box says it needs an Apple chip
  (M1 or newer). PDF regenerated 5 October.
- **Test tooling is in `tests/`** (see its README): answer keys and records
  for Roberts, the tuning, held-out, fresh and fresh2 sets, the CDP benchmark and
  grader (`bench.mjs`, `compare.mjs`), a regression suite of rule sentences
  (`rule-cases.mjs`, 30 cases, also a CI release gate), and the web, iframe, offline and desktop-link
  checks. Run the suite and the benchmark before shipping a detection change.
- **Open:** a third blind set before quoting a new rate; what fresh still
  leaks (two towns, a cooperative's acronym, three case numbers like
  "KCS-MDR-26-0031", a counseling practice, an employer, one bare "9/10");
  the real-hardware pass (to do 3); and the last audit item, the Docs
  add-on's `#gdoc=` link (to do 8).

## v80 / desktop 1.4.2 (initials and dates)

**A second blind set first.** Fixing the fresh set's misses meant reading
them, which would leave no blind check. So `tests/keys/fresh2.json` came
first: five more fictional records (preschool developmental delay
eligibility, OT evaluation, vision and O&M report, homebound plan, EBD
progress report) with 322 keyed identifiers, written 5 October by an agent
that never saw the rules.

**Rules added.** Each was dry-run against all five keyed sets before it went
in: every hit was a keyed identifier, and none touched a readable term.
- initials on a signature line, between the name and the date that ends it,
  after a dotted leader, a colon or a wide gap ("Rusty Blankenship, parent
  ...... RB 10/7/26"); codes that sit in that spot (SP, IP, OK, IEP, PT and a
  few more) stay readable;
- a contact log's initials, after the closing punctuation of a line that
  starts with its date ("06/24/2026 Called mother; left voicemail. DKM");
- an Init. column whose rows start with a weekday, past a row with no
  initials;
- school years without "SY" ("2026-27", "2025-2026"), the years one apart;
- De-Identifier only: a year after in, since, during, until, from, before or
  after ("moved back in 2016", "since the 2022 flood"), a season and year
  ("spring 2017"), and a month on its own ("passed in May", "last August").
  Paper Scrubber leaves these, since in an essay "in 2001" is usually history;
- a labeled nickname ("Nickname: Spud", "Goes by: Birdie");
- a clinic or hospital by name ("Highland Low Vision Clinic", "Kinnaird ENT
  Associates").

**Results, desktop behavior.**
- Blind (fresh2, before its misses were read): 11 of 322 through with v79,
  9 with the initials and date rules, about 97 in 100. The nine were
  contact-log initials, a nickname and a clinic; after the last three rules
  fresh2 is 0 of 322, and no longer blind.
- fresh: 39 of 356 through, now 11. Really 9: "PT" and "CH" still count only
  because the grader matches substrings ("PT" inside "PTA"); no standalone
  copy is left.
- Old sets: 7 of 744 through, now 1 (a "2019" in the tuning psych eval).
- No readable term lost anywhere, no quasi-identifier lost on the desktop,
  deep-model output identical, 30 of 30 rule cases pass.
- Web: fresh 45 → 18, tuning 10 → 5, held-out 4 → 3, fresh2 13 → 1. One
  web-only shift: the model had called "Laurel" (of "Laurel Branch
  Pediatrics") a town, and the echo pass scrubbed every "Laurel" in the
  tuning speech eval, by accident including the father's employer "Big Laurel
  Mining". The clinic rule now reads the clinic correctly, so on the web the
  employer is underlined, as employers are there by design.

## v79 and desktop 1.4.1 (rule gate, audit items)

- **The 22 rule cases are a release gate now.** `--rule-test=<cases.json>`
  runs them inside the desktop app (the same check as `tests/rule-cases.mjs`)
  on both CI machines, so a fixed leak or over-scrub that comes back stops the
  release. About 50 s on the dev machine.
- **Workflow:** the actions moved off Node 20 (checkout and setup-node v7,
  upload-artifact v7, download-artifact v8) and the build runs on Node 24.
  The release notes name the Apple chip.
- **Audit items fixed:** focus rings were 1.2–1.5:1 and are now 5:1 or more
  in both themes. The results summary is written again once the view shows,
  so a screen reader announces it. "Start over" during a batch run says why
  on its own line (the progress text used to overwrite it at once). A dropped
  scrubber-model download no longer fails the whole service-worker install;
  the model lands at the first scrub, and the offline chip stays amber until
  it does.
- **Handout:** the Mac box says "with an Apple chip (M1 or newer)".

## desktop 1.4.0 (Electron 43, Apple Silicon only)

Electron 33 was out of support and flagged by `npm audit`. The desktop
program now runs on Electron 43.7.7 (Chromium 150, Node 24), pinned exactly
(the lockfile is gitignored). `npm audit` is clean.
- **Why 43, not 44:** 44 needs macOS 13; 43 still runs on macOS 12 Monterey.
  Every supported Electron drops macOS 11 Big Sur (since 38), so Big Sur Macs
  stay on 1.3.10. Every Apple Silicon Mac can update to 13, so moving to 44
  later is one line in `desktop/package.json`.
- **Apple Silicon only, explicitly:** `--arm64` on both Mac build steps and
  `arch: arm64` in the Mac targets. The runner was already arm64; this keeps
  it that way if GitHub changes runners.
- **Since Electron 42 the binary downloads the first time `npx electron` runs**,
  not at `npm install`. The workflow's smoke step does exactly that.
- **Checked:** both release gates (dev and packaged Windows build), isolation
  and threads (three thread workers each, no thread errors), desktop links
  and Save, the 22 regression cases, and all 16 graded records: every finding
  identical to Electron 33.
- **Cost:** the deep check is about 10–15% slower on some records under
  Chromium 148–152 (Electron 42, 43 and 44 all measured; 297–306 s against
  257 s on five records), the same on others. Eager WebAssembly compilation
  (`--no-wasm-dynamic-tiering`) did not change it. Still well over twice as
  fast as before v65.

## v76 / desktop 1.3.10 (a fresh test set, and fewer leaks)

**A fresh, blind test set.** The held-out set had informed so many fixes that
it no longer tested fairly. `tests/keys/fresh.json` holds five new fictional
records (TBI eligibility, manifestation determination review, DHH itinerant
report, autism annual IEP, nurse seizure plan) with 356 keyed identifiers,
written by an agent that never saw the rules. One labeling difference: named
churches and businesses are keyed as identifiers there, where the old keys
call them quasi-identifiers. Graded on v75 before any change: 47 of 356 got
through on the desktop (about 87 in 100), against 15 of 744 on the old sets.
The old sets' rate reflects tuning.

**Fixed, written against the old sets only:**
- letter-digit codes: new ID labels (order, docket, petition, MRN, chart,
  patient) and a code shape with a four-digit run ("Ct. order 24-J-0087",
  "MRN LV-448120"), so CELF-5 and WISC-V stay readable;
- a seven-digit phone right after a phone word ("home 555-0187");
- initials after an Initials label, and in a data table's "Init." column
  (rows must start with their date, so "Progress Code: SP" stays readable);
- the rest of a dated list once two of its "(m/d)" points are caught
  ("63% (10/5)");
- a caught town echoing through the record ("of Redbud").

**Over-scrubs fixed on the way:** trial counts read as birth dates ("4/5
trials"); bare one- to three-digit numbers read as dates (WCPM scores, the
"504" of "504 plan", scale scores); a model ZIP with no five-digit run
("Lexile range 600-1100L").

**A regression caught before shipping.** The model had mislabeled "SY 25-26"
as a ZIP, and the new ZIP check dropped it. Two numbers a year apart are now
kept as a school year. The check reads the whole number run, because the
model had tagged only "25".

**Results:** old sets 7 of 744 through (was 15), fresh set 39 of 356 (was 47);
on the web 14 and 45. No leak, quasi-identifier or readable term was lost in
any record, and the 22-case suite passes. What still gets through on the
fresh set is initials in other shapes (17 of 28) and bare dates (15 of 74:
years, months, other school-year spellings, "the week of 9/22"). Fixing those
means reading the fresh set's misses, after which it is no longer blind:
write another set first, or accept that.

**Lesson.** A mislabeled model hit can be the only thing covering an
identifier. A check that drops a hit must be sure the text is no identifier
at all, and must judge the whole run the model cut into.

## v74 / desktop 1.3.8 (the deep model is 30% smaller, same answers)

Alex asked on 28 September to try cutting the deep model's vocabulary to
English, since English is what the tool reads. The model is multilingual: its
250,101-piece vocabulary table was 384 of its 580 MB (553 MB in the unit these
notes use). The new copy keeps every piece made only of Latin letters (accents
included), digits, punctuation, symbols and emoji, plus pieces with a single
Greek letter ("5 μg"). That is 135,933 pieces, and the model is now 386 MB in
five slices instead of seven. The De-Identifier's first-use download falls from
677 MB to about 500 MB.

**Why the cut stops at the whole Latin alphabet.** Half the vocabulary is
Latin-script (Spanish, French, Indonesian and dozens more spell with the same
letters), and a rare name like "Stidham" can split into any of those pieces.
Keeping all of them guarantees identical input for any English text. A Unigram
tokenizer only picks pieces that are substrings of the text, so nothing it
would have picked is gone. An English-frequency cut would have been smaller
(an estimated 250 MB, not built), but it changes how rare names split, and names are the thing
the deep check exists to catch.

**How.** `tools/trim-deep-model.py` (plain Python, no onnx package) copies the
kept embedding rows unchanged and renumbers the tokens. One trap: besides the
embedding lookup, the graph finds each label with `Equal(input_ids, 250103)`
(the `<<ENT>>` token), so that constant is renumbered too. The JS side
hardcodes only `[CLS]`=1 and padding 0, which stay put. The folder is
`models/onnx-community/gliner_multi_pii-v1-latin/`, with an Apache-2.0 change
notice. The old folder is deleted from the site (GitHub Pages caps a site near
1 GB, and both would not fit) and, through the new `RETIRED_MODELS` list in
sw.js, from each laptop's `kvec-models-v1` and `transformers-cache` when v74
takes over.

**Checked, 28–29 September 2026:**
- *Tokenizer:* 18,218 words (the eleven answer-keyed records, both samples,
  and a stress set with curly quotes, arrows, §, checkboxes, µg, emoji and
  names like José Peña, Nguyễn Văn Anh and Łukasz Żółć) tokenize to the same
  pieces as before.
- *Model:* both models side by side in headless Edge on every piece the deep
  check sends for those texts, 1,373 in all. On all 1,368 Latin-script pieces
  the raw logits were identical bit for bit, before any threshold, so every
  graded number (tuning, held-out and Roberts) is unchanged by construction.
  The four pieces in Cyrillic, Arabic, Chinese and Devanagari changed. Those
  scripts now read as unknown, and the regular scrub still runs on them.
- *Speed:* 786 s against 787 s for the whole set. The model loads in about
  half the time (1.2 s against 2.2 s from a local server), and it has 175 MB
  less of weights to hold in memory.
- *The real app, Pages-like server, fresh profiles:* a new laptop downloads the
  five slices at its first deep check (not isolated, single-threaded), and the
  chip turns green in that session. A simulated deploy after that re-downloaded
  nothing. With the server down, the deep check ran on the isolated page (three
  threads) and in an iframe (single-threaded), with the same six hits on the
  test record every time.
- *Upgrade from v73 with the old model downloaded* (the chip green, nine
  old-model files in `kvec-models-v1` and two in `transformers-cache`): when
  v74 took over, all eleven were deleted, and the deep-check runtime was kept.
  The chip turned amber, which is true, since the new model was not there yet.
  One online deep check fetched the five slices and the tokenizer, and the chip
  turned green. Site storage fell from 799 to 601 MB. Offline, the isolated
  page and the iframe both found the same six hits.

**Cost, as told to Alex before shipping:** each De-Identifier laptop downloads
the new 386 MB once, at its first deep check after the update, and the chip is
amber until then. Rebuilding the model means a new folder, never the same
paths, because laptops keep these files for good.

## v72 / desktop 1.3.7 (a county written "Co.")

"(gr 9, Brushy Co. High)" and "Brushy Co. Fair 2025": the deep check read
"Brushy Co." as a company, which the web only underlines, and the county rule
matched "X County" only. A second STATE rule now matches one capitalized word
plus "Co.". A business name with two or more words before "Co." ("Hensley
Lumber Co.") does not match and is left to the models. Re-graded on all eleven
records: both hits now scrub on the web, one more quasi-identifier is removed
there (30 of 102 in the tuning set), and nothing else moved. That closes the
Roberts review list.

## v71 / desktop 1.3.6 (headings and form labels are not schools)

GLiNER's "school" label fired on headings and form labels, and they passed
`looksLikeRealName` because every word was capitalized: in Roberts "Regular
Class" (x3), "Regular Classroom", "Special Education Services", "Present
Levels", "Placement", "School" and "Primary"; elsewhere "School Psych", "Gen
Ed", "Sp Ed/CM", "LEA", "DoSE", "ELA", "Secondary", "Exceptional Child
Education", "Special Ed.". A whole school hit made only of
`GENERIC_SCHOOL_WORDS` now stays readable (`looksLikeSchoolName`), because it
names no school.

Two guards, both found by the grader when a first version let "Brushy Co.
High" through on the web ("Brushy Co." is tagged as a company, which the web
only underlines, and the scrubbed "High" was what broke the name up):
- a generic hit ending in High/Middle/Elementary/School/Academy right after a
  capitalized word on the same line is the end of a real name and still
  scrubs (`endsSchoolName`);
- leftover pieces of a larger hit keep the old check, so "PUBLIC SCHOOLS"
  after a caught county name still scrubs.

Re-graded on all eleven records: 25 generic hits in nine records became
readable, and no leak, name-piece or quasi-identifier count moved under
either behavior.

## v70 / desktop 1.3.5 (support roles and lengths of time stay readable)

- **"Readers (content areas above…)" became a name.** The accommodation
  roles (reader, scribe, tutor, mentor, proctor) joined `JOB_TITLES`, and the
  role lists now count plurals, which also leaves "Guardians chose a Head
  Start class" readable in the preschool record. Plurals of the short
  pronoun entries are skipped, so "Wes" is still a name, not "we".
- **"graduate in 4 years" became an age.** `looksLikeAge` now calls a number
  of years, months, weeks or days a length of time when "in", "for",
  "within", "after", "over", "next", "past", "last" or "than" comes right
  before it, or "ago" after it. "6 years old", "4-year-old", "7 years of age",
  "(14 months)", "born at 38 weeks" and "at about 20 months" still scrub.

Re-graded on all eleven records: exactly those three findings changed, and
no count moved.

## v69 / desktop 1.3.4 (section numbers and staff titles stay readable)

- **"§6b Reporting" became a street address.** Anything the model tags right
  after a section sign is a section reference, and is dropped.
- **"the Speech/Language Pathologist" became a name.** GLiNER tags staff
  titles as people, and every word was capitalized, so `looksLikeRealName`
  let it through. `JOB_TITLES` (pathologist, therapist, psychologist,
  principal, coordinator, specialist and so on; either side of a slash)
  now rejects them, as `DEEP_NAME_STOP` already did for teacher and nurse.
  That also leaves a bare "Principal" readable in three of the test records;
  the person beside each one (Ronnie Gibson, Dwayne Ritchie, Rhonda Mayes,
  Garrett Slone) still scrubs.

Re-graded on all eleven records: no leak or quasi-identifier count moved;
Roberts keeps 40 of 50 readable terms on the desktop and all 50 on the web.

## v68 / desktop 1.3.3 (aim lines and regulation numbers stay readable)

Two more Roberts over-scrubs, fixed and re-graded on all eleven records:
- **"graphed against a 60→80 aim line" became a birth date.** No date is
  written with an arrow, so a letter-free model date containing one is dropped
  (`looksLikeArrowRange`).
- **"703 KAR 5:070" became a street address.** A number-only model finding
  inside a regulation or statute citation (`N KAR`, `N CFR`, `N U.S.C.`,
  `KRS N`, `CFR N`) is dropped as part of the citation (`CITATION`). The test
  sets also carry "704 KAR 7:160" and "707 KAR 1:360".

Roberts readable terms: 39 of 50 on the desktop, 49 of 50 on the web (was 38
and 48). No other finding changed; addresses, dates, ZIPs and phones next to
these still scrub.

## v67 / desktop 1.3.2 (the Roberts leak and the fractions)

Two findings from grading the Roberts model IEP (v65 below), both fixed and
re-graded on all eleven answer-keyed records, desktop and web behavior:
- **"documented Karen-style" left "Karen" readable.** Neither AI tags a name
  glued to "-style", "-like" or "-esque", so a rule does: a capitalized word in
  that shape is a NAME, and the "-style" stays readable ("[NAME]-style").
  De-Identifier only, since an essay says "a Shakespeare-style sonnet". Method
  names in `EPONYM_OK` ("Wilson-style", "Venn-style", "Montessori-style") and
  role words are left to the other checks.
- **"can order fractions 1/2, 1/3, and 1/4" became birth dates.** The main
  model called "2, 1/3" and "1/4" a DOB. `looksLikeFraction` drops a model
  date made only of slash numbers when the words just before it in the same
  sentence are about fractions, or a unit or "of the" follows ("3/4 cup", "1/2
  of the class"). A date word right before it keeps it a date ("fractions on
  4/2"), and three-part dates and month names are never touched. Both tools.

Result: Roberts 0 of 19 identifiers through (was 1), no name piece left,
readable terms 38 of 50 on the desktop and 48 of 50 on the web (was 37 and 47).
Every other finding in all eleven records is unchanged.

## v66 (the web De-Identifier stays offline-ready across updates)

**Two faults, found on v65.** Both broke the promise that one visit on Wi-Fi
leaves a laptop ready for a building with no signal:
- *The trust chip could never turn green.* `isRoadReady()` in app.js wants
  `vendor/gliner-ort/ort-wasm-simd-threaded.mjs` in the cache. Before v65
  nothing fetched it. Since v65 only a multi-threaded session imports it
  (isolated page and 3+ cores, since ONNX Runtime uses `min(4, ceil(cores/2))`
  threads). First visits, iframe embeds, hard reloads and dual-core laptops
  never do, so the chip said "Getting offline-ready in the background — stay
  online a bit" forever. It was worse than a wrong label: a laptop whose deep
  checks had all run single-threaded would have failed offline the first time
  it ran isolated, because the threaded loader imports that file.
- *Every deploy deleted the deep check's runtime.* `vendor/gliner-ort/` (11
  MB .wasm, 24 KB .mjs) went into the versioned cache at the first deep check,
  and each deploy's cleanup deleted it (the rescue only moved `/models/`
  paths). After any update, an offline laptop could not deep-check until it
  had been online once.

**The fix is all in sw.js.** `vendor/gliner-ort/` is treated like a model
(`isDurablePath`): it is stored in `kvec-models-v1` and rescued from old
versioned caches on activate. The 24 KB .mjs is precached into
`kvec-models-v1` with the scrubber model (`MODEL_ASSETS`, skipped once held).
The 11 MB .wasm is not precached, because Paper Scrubber teachers share that
install. Like the model parts, it lands in the durable cache at the first
deep check. `isolate()` is unchanged. `deep-check-worker.mjs` was not touched,
so the desktop installers did not rebuild.

**New rule.** Nothing in `vendor/gliner-ort/` is ever re-fetched now. A newer
deep-check ONNX Runtime must go in a new folder (update `wasmPaths` in
deep-check-worker.mjs, the `isRoadReady` list in app.js and the precache
line in sw.js), never over these files. Otherwise laptops keep the old
.wasm next to a rebuilt bundle. Bumping `kvec-models-v1` also works, but it
makes every laptop download 553 MB again.

**Tested** on 28 September 2026 in headless Edge with fresh profiles. The
harness served the repo the way GitHub Pages does: under `/paper-scrubber/`,
with `max-age=600` and no COOP/COEP headers. "Offline" meant the server was
shut down with every socket destroyed. The test record is a short synthetic
one, and each deep check found the same six context hits.
- *Fresh laptop, v66:* on the first visit (not isolated, single-threaded),
  install fetched the .mjs and the first deep check fetched the .wasm. Both
  went into `kvec-models-v1`, and the chip turned green in that same session.
  Next, a simulated deploy (v66 → v67): `paper-scrubber-v66` was purged,
  nothing was re-downloaded, and the chip stayed green. With the server down,
  the deep check ran on the isolated top-level page and inside an iframe on
  the Paper Scrubber page (not isolated, single-threaded). Both chips were
  green, and so was Paper Scrubber's.
- *Upgrade from v65:* the first deep check left the .wasm in
  `paper-scrubber-v65`, no .mjs anywhere, and the chip amber (the bug,
  reproduced). Deploying v66 fetched only the .mjs, moved the .wasm into
  `kvec-models-v1`, and the chip turned green without another deep check.
  With the server down, the isolated page ran the deep check on three
  `em-pthread` threads loaded from the cached .mjs. The iframe ran it
  single-threaded.
- The only console output was ONNX Runtime's usual constant-folding warning.
  There was no `worker sent an error!`. The harness (`offline-test.mjs`) lived
  in the session scratchpad and is not in the repo.

## v65 / desktop 1.3.1 (the deep check is 3x faster; Mac ad-hoc signed)

**Speed, measured one change at a time** on 28 September 2026, in the dev
desktop app over DevTools (i9-9900K, 8 cores): the Roberts model IEP (28,832
characters) and the two answer-keyed sets from v64, eleven records in one
batch. Deep-check seconds per document are timed from the worker request to
its answer, with both models already loaded. Every change was graded under
desktop behavior (everything detected is replaced) and web behavior (the
`DEFAULT_KEPT` categories stay underlined).

| Deep check, seconds | v64 | (a) skip + reuse | (a) + threads |
|---|---|---|---|
| Roberts IEP | 398 | 311 | 129 |
| Tuning set, 5 records | 754 | 583 | 246 |
| Held-out set, 5 records | 754 | 581 | 246 |
| All 11 | 1,907 | 1,476 | 621 |

Web (Edge 154 through the service worker): Roberts 333 s without isolation,
154 s with it; all eleven 745 s. Graded results are identical in every column
and in both behaviors: tuning 8 of 367 identifiers through, held-out 7 of
358, Roberts 1 of 19; quasi-identifiers removed 65 of 102 and 52 of 75;
readable terms kept 47 of 50 and 45 of 60 (web: 50 of 50 and 60 of 60). Deep
spans are identical down to the score. The only output change is a form
blank ("__") the deep check used to tag as a career interest.

- **(a) Kept.** `deep-check-worker.mjs` skips sentence pieces with fewer than
  three letters and reuses the answer for a piece it has already seen (form
  labels, headings, boilerplate across a batch; up to 5,000 pieces). 13% fewer
  pieces (1,602 → 1,396) and repeats answered from memory: 1.29x faster. The pieces it skips were lone initials and titles
  ("J.", "Mr."), and the rules and `looksLikeRealName` already handled them.
- **(b) Rejected.** Packing consecutive short pieces into one call, as the
  original text slice. With 400-character packs: 2.9x faster than (a), but
  "Journey" (a preschooler's name), "Big Laurel Family Health", "Mountain Laurel
  ENT", "his uncle", "his stepdad" and more dropped out. 150-character packs,
  1.56x faster, still leaked "Journey", "Troublesome Creek Pediatrics" and
  "Brushy Fam. Ct.". That is the documented score collapse with input length;
  the worker's header comment now says not to pack.
- **(c) Kept, after a fix.** Cross-origin isolation (COOP `same-origin`, COEP
  `require-corp`) so ONNX Runtime can use WebAssembly threads (4 on this
  machine: `min(4, cores/2)`). Isolation alone made it *slower* (0.94x): the
  threads started and failed with `worker sent an error!
  gliner-bundle.mjs:3614: aT is not a function`. **Cause:** esbuild had folded
  ONNX Runtime's glue into `vendor/gliner-bundle.mjs`, whose loader ignored
  `wasmPaths`, so its thread workers started from the bundle, which cannot
  start as one. The error also made the app's `onerror` terminate the deep
  worker after every document, so each record reloaded the 553 MB model. It
  never failed a document here, but it could have. **The fix is one patched
  line in the bundle** (search it for `ort-wasm-simd-threaded.mjs`): with
  threads, the loader imports `vendor/gliner-ort/ort-wasm-simd-threaded.mjs`,
  the standalone glue of the same build (same `___start_em_js` fingerprint),
  which starts threads properly. Without threads, the old path is untouched.
  Re-apply it if the bundle is ever rebuilt. Result: 2.38x over (a), about
  390% CPU, three `em-pthread` workers inside the deep worker, one model load
  per session.

**Where isolation applies.** Desktop: the loopback server sends both headers
on every response. Web: `sw.js` adds them (GitHub Pages cannot), but only the
De-Identifier's own page is isolated; Paper Scrubber's page is left as it was
(no deep check to speed up, and iPhones and Chromebooks run it). Workers and
scripts carry the headers too, because an isolated page refuses a worker
whose script lacks them. Isolation starts on the next load after the new
service worker takes over. The page never reloads itself for it (tested: the
update landed under an open paper and the paper stayed). Checked working:
scanned-PDF OCR (pdf.js and Tesseract workers) on the isolated desktop and web
pages; a hard reload, which bypasses the service worker, so the page runs
single-threaded as before; both tools inside a cross-site iframe, which cannot
be isolated because the parent is not, so they scrub single-threaded exactly
as before. theholler.org does not iframe the tool today: /paperscrubber/ is an
Elementor HTML widget with a link button.

**Roberts IEP, answer-keyed** (19 identifiers, 9 quasi-identifiers, 50 terms
that must stay readable; key in the session scratchpad). In plain English:
- *Leak:* "Karen" in "documented Karen-style" stays, in the text and in the
  rebuilt Word file. A bare name in an odd spot; known since August.
- *Left readable:* "Grade: 8" (the GRADE rule catches "8th grade", not a
  grade after a form label) and "staying in shape" (an interest).
- *Over-scrubbed in both editions (17 hits):* the fractions "1/2, 1/3, and
  1/4" and the aim line "60→80" read as birthdates; "703" of "703 KAR 5:070"
  and "§6b Reporting" as addresses; "Speech/Language Pathologist" and
  "Readers" as names; "4" of "graduate in 4 years" as an age; table and form
  headings as schools ("Regular Class" x3, "Regular Classroom", "Special
  Education Services", "Present Levels", "Placement", "School", "Primary" of
  "Primary Disability").
- *Over-scrubbed in the desktop only (82 more):* deep-check hits the desktop
  replaces under Alex's scrub-everything decision (a known cost, not an open
  item). Headings and subjects ("Testing", "Writing", "Math", "Language Arts",
  "General Intelligence", "Baseline", "Goal 4"), supports ("cue cards",
  "text-reading software", "Supplementary Aids and Services", "Check and
  Connect"), the IQ score "69", "5th-grade" and "12th grade" used generically,
  and the special-factor questions ("blind or visually impaired", "deaf or
  hard of hearing"). 86 of 110 occurrences of the needed terms survive on the
  desktop, 107 of 110 on the web.

**Mac: ad-hoc signed.** `mac.identity: "-"` and `hardenedRuntime: false` in
`desktop/package.json`. That needs **electron-builder 26** (26.1.0 added ad-hoc
signing; 25.1.8 took `"-"` as a keychain name, found nothing, and silently
skipped signing), so it is pinned at 26.15.7 (exactly: `desktop/package-lock.json`
is gitignored, so CI resolves ranges fresh). The workflow now fails the Mac
build unless `codesign` verifies and reports `Signature=adhoc`. **26's own
signer stalls on the GitHub Mac runner.** It runs codesign once per file in the
bundle, and the first CI runs sat in packaging-and-signing for over an hour,
then for 30 minutes with timestamps off (it used to take 2 minutes; the log
needs a GitHub sign-in to read, so the exact file is unknown). Signing now goes
through `mac.sign` → `desktop/adhoc-sign.cjs`: one `codesign --force --deep
--sign - --timestamp=none` over the app, the standard ad-hoc sign for Electron.
The Mac build runs as three steps (package + sign, signature check, DMG + zip
from the signed app via `--prepackaged`), each with a time limit, so a future
stall shows where it is in the public step timings. First launch
on a current Mac: open it, click Done, then System Settings → Privacy &
Security → Open Anyway. The Windows build with 26.15.7 was made on this
machine and passed `--smoke` and `--scrub-test` as a packaged exe (still
unsigned, as before).

**Desktop links.** Footer, help and privacy links open in the regular browser
(`setWindowOpenHandler` + `will-navigate` in main.js). The tool's own pages go
to their public copies, and the window never leaves the tool; Save downloads
are unaffected (tested with `shell.openExternal` stubbed). The "Want it as a
program?" footer line is hidden inside the program.

**Handout.** The promise now gives the tested rate (about 98 of every 100
identifiers; 728 of 744 across the three sets) instead of "never receives a
name, a number". The "machine test that blocks any release that would leak"
clause went with it, since 2 in 100 do get through. Mac steps: Privacy &
Security → Open Anyway. Timing: about 2 minutes for a long IEP, 1 for a short
eval. The printable PDF made from it in August is now out of date.

**Lessons.**
- A worker that starts threads can fail inside them silently. Check the
  console for `worker sent an error!`, and count busy cores, before
  believing `crossOriginIsolated === true` means anything.
- CDP `Page.reload({ ignoreCache: true })` is a hard reload and bypasses the
  service worker. Web tests must use a normal reload.
- A test stub must be verified before it is relied on. A failed
  `shell.openExternal` stub once opened every footer link in the real browser.

**Still open.**
- ~~The web De-Identifier's offline chip can never turn green, and every
  deploy wipes the deep check's runtime.~~ Fixed in v66 (above).
- Electron 33 is flagged by `npm audit` (every version up to 40), as is its
  installer's extract-zip. Older than this change, but worth an upgrade pass.

## v64 (light/dark switch; what testing the installed desktop app found)

On 23 September 2026 the released installers were downloaded (checksums
verified), the Windows build installed, and the installed program driven
end to end over the DevTools protocol (`De-Identifier.exe
--remote-debugging-port=9333`). Install location, Start-menu and uninstall
entries, Open With, the release gates, hidden Word parts, scanned-PDF OCR and
the network (loopback only) all checked out. Detection was the weak spot.

**How detection was measured.** Two sets of synthetic, answer-keyed records
(five each: ARC notes, transition IEP, FBA/BIP, speech eval, psych eval; then
a held-out re-eval summary, preschool IEP, OT eval, progress report, 504 plan)
went through as one batch, graded with desktop semantics (everything detected
is replaced). Rules were written against the first set only; the held-out set
checks they generalize. An identifier counts as leaked if it survives
verbatim; a person also counts if any piece of their name survives:

| Measure | Installed 1.2.1 | v64 / 1.3.0 |
|---|---|---|
| Tuning set: identifiers that got through | 35 of 367 | 8 of 367 |
| Tuning set: people with any piece of their name left | 17 of 167 | 0 of 167 |
| Tuning set: terms that must stay readable, kept | 33 of 50 | 47 of 50 |
| Held-out: identifiers that got through | 45 of 358 | 7 of 358 |
| Held-out: people with any piece of their name left | 29 of 157 | 3 of 157 |
| Held-out: terms that must stay readable, kept | 34 of 60 | 45 of 60 |
| Quasi-identifiers removed, both sets | 116 of 177 | 117 of 177 |

The held-out set is not pristine any more. Measured before any change it
informed, the new rules let 11 of 358 identifiers through there (12 of 157
people by the piece count). The later fixes it prompted are general shapes
(listed below), not document-specific patches. The scratch tooling for this
(answer keys, the CDP grader, the piece-count rescorer) lived in the session
scratchpad and is not in the repo.

**What was added** (all in app.js, see the comments there): dotted initials
("J.M.", minus degrees, times and places), signature initials on form lines, a
first name after a family role or honorific ("Mamaw Hope", "Coach Gunner"),
labeled case/lunch/record numbers with letters, rural routes and P.O. boxes,
"X Holler/Hollow", "X County", named-month dates, "age 6", phone extensions,
school initials echoed from the school's full name ("CFMS"), a middle initial
joining two name pieces, and a first name + initial pulled onto a caught
surname. On the keep side: test, subtest, score and service names
(`KEEP_TERMS`) never scrub as health/age/activity, and a model AGE or SSN
must look like one, so standard scores and T-scores stay readable.

**Regressions caught in the teacher tool and fixed before shipping:** a name
ran on across a sentence end ("J.R.R. Tolkien. In history" swallowed "In"),
the period itself went into the tag ("[NAME] I also liked"), two people across
a sentence merged into one tag, and historical dates scrubbed. Names now stop
at a real sentence end (honorifics and initials still continue), and a date
whose year is before 1900 stays readable (only a real date shape counts, so a
house number the model calls a date stays scrubbed).

**Fixed from the held-out set** (general shapes, but they are why that set is
no longer pristine): the AGE check forgot "weeks" ("born at 35 weeks"); "D.C."
was allowed as a place everywhere and is now allowed only after "Washington",
since in a progress report it was a person; and a deep-model context hit was
thrown away whole when a regular finding overlapped it ("CFMS archery team"
left "archery team" readable), so the rest of such a hit now stays a finding.
A stricter scorer then found name pieces the first grader could not see,
because it only counted a keyed string that survived whole. Two shapes were
fixed: the name echo now also scrubs the ALL-CAPS form of a caught name
("Colton W. Fields" in the body, "STUDENT: FIELDS, COLTON WAYNE" in the
header), and the capitalized word between a form label and a caught surname
joins the name ("Outside therapist: Journey Adams"; role words such as "Coach"
stay readable). The cost: a caught surname "Hall" also scrubs "CITY HALL".
The ALL-CAPS echo then exposed one more overlap case: once "FIELDS" was
echoed, the deep model's hit on "FIELDS, JOURNEY RAE" overlapped it and was
dropped, so "JOURNEY RAE" leaked. Leftover pieces of deep name and school hits
now stay too, if they still pass `looksLikeRealName`. The deep stop-list also
gained "preschool" (a heading it read as a school) and clinician credentials
such as "LPCC". Last, a nickname in quotes right after a caught name is now
the same person and echoes through the record: 'Wren Callie Stidham-Rose
("Wrennie")', 'Jaxon (goes by "Jax")', 'Loretta "Retta"'. Quoted words that
don't follow a name ("Great job", a book title) stay readable. Scores kept
readable too: an ordinal is a rank, not an age ("21st percentile"), a short
number after a score label is not an ID ("scale score 471"), and "i-Ready
Reading/Math" is a test name, not an activity.

**Light/dark switch.** ☀️ Light / 🌙 Dark in the masthead of both tools and the
privacy page, applied before first paint. The web remembers it in
`localStorage` (`kvec.theme`); the desktop edition opens dark and stores the
choice in `settings.json` in its user-data folder, because its page origin is
a new loopback port every launch and browser storage forgets. Verified: the
choice survives a relaunch and the window background matches, no flash.

**Desktop wording fixed.** The desktop page said "First use downloads both AIs
once (about 650 MB)" and its help described judging underlines. Both models
ship inside the program and nothing is judged there, so the desktop edition
now says so.

**Lessons.**
- A patch script that uses `String.replace(a, b)` with a plain string `b`
  expands `` $` `` and `$'` in it — it spliced the file's own prefix into
  app.js once. Use `s.replace(a, () => b)`.
- Node 24 accepted that broken file; Electron 33's engine (Node 20) did not,
  and the desktop app died with `__dev` undefined. Syntax-check with both:
  `node --check app.js` and `ELECTRON_RUN_AS_NODE=1 npx --prefix desktop
  electron --check copy-of-app.mjs` (it needs the .mjs extension).
- Escaping in nested string patches ate backslashes in one regex silently
  (`+s[A-Z].s` instead of `+\s[A-Z]\.\s`). Re-read patched regexes.
- Grade name leaks by piece, not by whole string. "FIELDS, [NAME 1]" is a
  leak even though "FIELDS, COLTON WAYNE" no longer appears.
- The desktop version sat at 1.2.1 across many builds, so installers were
  indistinguishable. It is 1.3.0 now; bump it when the engine changes.

**Still open, and why.**
- Leaks that remain are hard shapes: bare two-letter initials ("CS"), a
  seven-digit phone with no area code, an ID with an unusual label, a
  school-year range ("2025-26"), a bare "10/5".
- The teacher tool now scrubs author initials ("E.B. White"), "Harlan County",
  "Sleepy Hollow" and "Brother Bear" in a book report, and "CITY HALL" once
  "Hall" is a caught surname. Deliberate: in eastern Kentucky those shapes are
  usually a real person or a home place, and the teacher can click one to
  restore it.
- Tags stay exact-match by design, so "Mrs. Faith Hensley" and "Faith
  Hensley" get different numbers in one paper. Still scrubbed, never leaked.
- **Known cost of Alex's scrub-everything decision (not open):** the desktop
  edition scrubs diagnoses and eligibility categories along with everything
  else, so the outside AI sees less of an IEP. That is the zero-questions
  design working as Alex specified. It changes only if Alex decides it should.
- Narrative quasi-identifiers ("the only student to bring a calf to school")
  are beyond any detector here; the neighbor-test help text covers them.

## v60–v63 (why it looked frozen, and the install wording)

**A deploy could get stuck on a device forever.** Reproduced live: GitHub's
CDN propagates files at slightly different times, so a browser can fetch the
new `sw.js` before the new `app.js` has landed on its edge. `cache.addAll`
then filled the NEW cache from the browser's HTTP cache — i.e. with the OLD
`app.js` — and since `sw.js` does not change again until the next deploy, that
stale copy was served indefinitely. In an iframe there is no escape at all: a
hard refresh of the parent page does not reach the embedded app's worker.

Three fixes, all live:
- Registration uses `updateViaCache: 'none'` plus `reg.update()` on load.
  The default lets the browser serve `sw.js` itself from its HTTP cache, and
  Pages sends `max-age=600`, so for ten minutes it never even checked.
- Precache fetches with `cache: 'reload'`, so it can never capture whatever
  the browser was holding.
- **The small files that carry behaviour (`*.html`, `*.js`, `*.mjs`, `*.css`
  outside `vendor/`) are fresh-first with a 3 s budget, then the cache.**
  Everything heavy — `vendor/`, `models/` — stays cache-first and is never
  re-downloaded. Road-ready is intact: airplane mode fails instantly and falls
  through to cache; a hung connection is cut off at 3 s.

Also: the install button now says **"Keep it on this computer"** and, once
installed, the page says where it landed (Applications/⌘-Space on a Mac, Start
menu on Windows, launcher on a Chromebook) — Alex installed it, liked it, and
could not find it again. The teacher help section was rewritten to match: the
link works everywhere with nothing to install, the icon is optional.

**Decided against a downloadable installer for teachers.** Their fleet is
mixed (Windows, Chromebooks, Macs), so a download excludes Chromebooks
entirely and hands the rest an unsigned-binary warning — more confusion, not
less. A Paper Scrubber build would be ~130 MB (it skips the 568 MB deep model)
if that ever changes.

## v58–v59 (the KVEC mark; the De-Identifier goes link-only)

- **The logo is finally there.** Alex sent the white-wordmark version, which is
  drawn for a dark background, so the white box `.coop img` used to sit it in
  had to go — it would have erased the words. Trimmed, 248x180, precached. The
  site's last 404 is gone.
- **The De-Identifier is unlisted, not gone.** While the review team trials it,
  it is reachable only by its URL: the two public pointers on Paper Scrubber
  (footer line and help bullet) are removed and `deid/index.html` carries
  `noindex, nofollow`. The page, its handout, the manifest, the installers and
  the service-worker precache are all untouched — staff links keep working.
  **To re-list it:** delete that robots meta and restore the two links.
  Note a project site cannot serve its own robots.txt (crawlers only read the
  one at the domain root, which lives in another repo), so the per-page meta
  tag is the mechanism that actually applies here.

## What changed in v57 (the last hyperlink hiding place)

Closes the final open item from the v51 review. A `HYPERLINK "mailto:…"` field
kept its real target in two shapes the per-element pass could not see:

- **Split across runs.** Word breaks an instruction wherever it likes, so
  `HYPERLINK "mailto:jayden.co` + `mbs@school.org"` arrives as two halves that
  each look harmless — neither holds a balanced quote pair. The pieces between
  `fldChar` boundaries are now assembled, judged as one instruction, and the
  fixed instruction is written back into the first piece with the rest emptied
  (Word reads the concatenation, so that is the same instruction).
- **`w:fldSimple w:instr=`**, where the instruction lives in an attribute and
  its quotes are `&quot;`-escaped. Decoded, judged, re-encoded.

Still only HYPERLINK and only its first argument, so a `\o` screentip, a
`STYLEREF "Heading 1"`, and a `gutenberg.org` citation all survive untouched —
verified, along with the split and attribute forms, in unit tests and through a
real .docx in the running app.

## What changed in v56 (desktop installers rebuild with the engine; deep-check failure is visible)

Two findings from a "is it all good?" check on 14 September 2026:

- **The Mac/Windows installers were stale.** They bundle the engine at build
  time, but the desktop workflow only rebuilt on `desktop/**` changes — so the
  v51 Word-container privacy fix (tracked-change deletions, custom.xml, link
  targets) shipped to the web on 28 Aug and never reached the installers built
  19 Aug. The workflow now also triggers on app.js, deep-check-worker.mjs,
  labels.js, sample.js, styles.css, deid/**, models/**, vendor/**. Rule going
  forward: **any engine change rebuilds both installers automatically**; the
  release link always serves the newest build.
- **A failed deep check is no longer invisible** (was the second open item from
  the v51 review). `detectText` now takes the paper and sets `paper.deepFailed`
  in its catch; the review shows a `#deepNote` warning banner (deid page),
  the summary line is prefixed "⚠️ Deep check did not run.", batch rows say
  "re-run before sharing", and the desktop edition hides its "nothing you have
  to do here" hint when it isn't true. The CI `--scrub-test` gate now also
  requires `deep >= 1`, so a silently failing deep model fails the release
  instead of shipping a light-scrub-only installer.

Verified: desktop smoke + scrub-test pass on this Windows machine with the v55
engine (9 findings, 3 deep, 0 flagged, 0 leaks); the web failure path was
forced by stubbing `Worker` and the banner/prefix appeared with the light scrub
intact. Desktop version 1.2.1.

## What changed in v54–v55 (deploys stop deleting the models)

Model weights now live in their own cache, `kvec-models-v1`, which the
version cleanup never touches — before this, every CACHE bump threw away the
De-Identifier's 553 MB deep model and the 64 MB scrubber and every laptop
re-downloaded them. The activate handler also *migrates* any model entries it
finds in old versioned caches before purging, so this upgrade is the last one
that could have cost a re-download. The scrubber model still precaches on
install (road-ready unchanged), but skips files it already holds.

**New deploy rule:** `kvec-models-v1` is keyed by path, so it must be bumped
only if a model file is ever REPLACED at the same path — new models get new
directories and need nothing. (v54 was a local test version; v55 shipped.)

## What changed in v52 (the computer-noob pass)

A 24-proposal novice-usability review (all adversarially verified) got
implemented in one sweep. Front-page prose went from ~190 words to 76 and the
whole flow fits a 1366x768 screen. The offline status lives in the trust
strip's middle chip now (roadReady element is gone; the wrong "~100 MB" line
went with it). "Try an example first" is the first button; the Scrub button
soft-disables and explains an empty-box click; unreadable files show as
warning rows with tailored rescues (.gdoc says open-the-Doc-and-paste);
legend checkboxes show honest indeterminate states; the summary says "you
decide"; marks light up on hover; a stalled model download says so instead of
freezing. Long paragraphs moved into the help dialog.

Also fixed on the way: this Mac's ssh config lost the beadbeed3000 identity to
the newer TavernGame agent key (`Hi beadbeed!` push rejection) — the plain
`Host github.com` block now carries `IdentitiesOnly yes`, matching the intent
comment already in the file.

## What changed in v51 (the parts of a Word file you cannot see)

Four ways a "de-identified" .docx still named the student, all reproduced on
the live site with an IEP-shaped file and all fixed:

- **A tracked-change deletion kept the name in full.** `parseDocx` collected
  only `<w:t>`, so `<w:delText>Jayden Combs</w:delText>` was never scanned,
  never a finding, never replaced — and Word shows it in All Markup. IEP
  drafts carry tracked changes constantly, so this was the worst of the four.
- **`docProps/app.xml`** kept the title in `TitlesOfParts`, which survives
  blanking `dc:title` in core.xml. Both that and `HeadingPairs` now go.
- **`docProps/custom.xml`** rode through untouched — where a district document
  library pushes columns like Student and Case Manager. The part is dropped
  along with its Content_Types Override and package relationship.
- **Hyperlink targets survived.** The text read `[EMAIL]` while
  `word/_rels/document.xml.rels` still held the real `mailto:`.

Closed at the same time: **customXml data parts** (a data-bound content
control refills the visible text from these on open — the one that could put
a name *back* into a cleaned document; the part stays for validity, the data
is blanked) and **picture alt text**, which routinely names the child.

**Do not "fix" the run joining.** Separating a tracked deletion from its
replacement reads better, and was tried: Word tracks edits a character at a
time, so the separator split a phone number around a retyped digit and the
number stopped being detected at all. Joining costs an occasional swallowed
word next to a deletion — over-scrubbing, the direction this tool errs in on
purpose. Measured, not guessed.

Link targets are matched only against identifier findings (EMAIL/PHONE/ID/
USERNAME/SSN/LINK, ≥6 chars) and only HYPERLINK's first argument is rewritten,
so a citation to `hazard.k12.ky.us` and a `STYLEREF` field both survive a
document that scrubs the word "Hazard".

**Known and still open after this pass** (a 20-agent adversarial review of the
fix; these survived verification):
- A field instruction split across several `<w:instrText>` runs, and
  `w:fldSimple w:instr=`, keep their real target. The common `w:hyperlink` +
  .rels form is covered; these legacy field forms are not.
- A failed deep check is invisible: its only notice goes to the status line,
  which `hideStatus()` wipes before the review opens. The desktop edition then
  still says "there is nothing you have to do here" over a light-scrub-only
  result. Record it on the paper and show it in the review.
- The De-Identifier's setup line says "~100 MB". Measured: 96 MB for Paper
  Scrubber, 677 MB for the De-Identifier.
- Deep-check recall is phrasing-sensitive — "free lunch" and "grandmother"
  were caught in the CI sentence and missed in a differently-worded one. The
  `--scrub-test` gate is a regression canary, not a coverage guarantee.

## What changed in v40 (road-ready + neighbor test)

Built for Alex's team running IEP reviews on the road (Mac + Windows laptops,
no-signal buildings, district networks that block huggingface.co):

- **The model ships with the app** (`models/`, 64 MB in the repo). Loaded by
  pointing `env.remoteHost`/`env.remotePathTemplate` at our own `models/` folder —
  NOT `env.localModelPath`, which in this transformers.js build (4.2.0) loses the
  tokenizer (`this.tokenizer is not a function`; config + weights load, tokenizer
  comes back undefined). The remote-path-aimed-at-ourselves route uses the code
  path that has worked since day one. No request ever leaves our origin now.
- **Road-ready line** on the front page: verifies every scrub-critical file
  (app, runtime, model, PDF/OCR readers) is actually in the device cache and
  says so; polls until the background precache finishes. The install story for
  the team is: open link on Wi-Fi → install as app → wait for the green line.
- **Neighbor-test categories**: HEALTH (diagnoses/meds/assistive devices — curated
  wordlist, no service terms like "speech therapy" which appear in every IEP) and
  GRADE start **kept-but-underlined** (`DEFAULT_KEPT`) — flagged for the teacher's
  judgement, one click or one category chip to scrub. ROOM (bus/room numbers)
  scrubs by default. Help dialog has a "neighbor test" section: the tool does
  direct identifiers, the human judges identifying *combinations*.
- Existing installs re-download the 64 MB model once from our origin (cache keys
  changed from huggingface.co URLs); old HF entries linger harmlessly in
  `transformers-cache`.
- Storage note: the model may be cached twice (SW precache + transformers-cache),
  ~130 MB total. Accepted for robustness.

## What changed in v38–v39 (audit fixes)

A six-lens code audit found a real leak and several detection gaps. Fixed and
verified against the running app:

- **The Word container was never scrubbed.** `docProps` (`dc:creator`, `dc:title`,
  `cp:lastModifiedBy`), `w:author`/`w:initials` on comments and tracked changes, and
  `word/people.xml` all rode into the "scrubbed" download while the headline said
  *Replaced N personal details*. `stripDocxIdentity()` now blanks them on every
  Word build. This one was reproducible on the live site — a file authored by
  "Jayden Combs" came back scrubbed in the body and still named him in Explorer.
- **File names leaked too** — `Dalton Hall essay.docx` → `Dalton Hall essay-scrubbed.docx`.
  Safe file names (tick-box, default on) save each paper under its tag instead,
  with a `WHO-IS-WHO` key in the zip. See the README.
- **Accented names were invisible to the detector.** The English model is *uncased*
  and its tokenizer strips accents, so it returned "jose" for text reading "José";
  `mapTokens`' `indexOf` found nothing and dropped the token, so the name never
  became a finding. `foldForMatch()` folds both sides one UTF-16 unit at a time so
  offsets still line up. José Peña / Renée Dubois / Björn Åkesson / Sofía Martínez
  all went from *undetected* to caught.
- **Entity scores were averaged**, letting weak subword pieces drag a confident
  detection under the 0.4 threshold — now the max token score.
- **Chunking counted characters against a 512-*token* limit.** Dropped to 900 chars
  and `scanChunk` re-splits anything that still comes back at the token ceiling,
  so the tail of a dense page is never silently skipped.
- All-caps letterheads (`BELFRY MIDDLE SCHOOL`) now match; non-breaking spaces from
  Google Docs exports no longer end an entity mid-name; a failed batch Save reports
  itself instead of looking like success.
- **Spanish/multilingual removed** (Alex's call, August 2026) — see the README for
  what to restore if a foreign-language teacher asks.

**Validated against a realistic IEP (Aug 2026):** a 29k-char fictional KDE-model
IEP (PD training doc) went through the De-Identifier end to end. First pass
leaked three things — labeled 6-digit student number, zip behind the state
abbreviation, single-digit hyphen dates — and over-scrubbed "Quantile"
document-wide via possessive extension + echo. All four fixed (see the
regex rules and the possessive stop in extendEntities); final pass: 161
findings, zero leaks in text and in the rebuilt .docx body, curriculum terms
(Quantile/EXPLORE/Cuisenaire) readable. Known residual, on purpose: a bare
first name in an odd syntactic spot ("documented Karen-style") can slip past
the model — the shape of miss that still exists and why the review screen does.

**Known and deliberately not fixed:** images inside a .docx are left intact
(deleting `word/media/*` would gut the student's work). Also seen in testing: when
the model labels a person as ADDRESS/CITY rather than NAME, that person gets a
different tag in that paper than in one where it read NAME — still scrubbed, never
leaked, but the key file reads oddly. Worth a look; identity is type-scoped today.

## Shipped features (overview)

Everything below is shipped and live at
https://beadbeed3000.github.io/paper-scrubber/ (all tested against the running
app before each push).

**Formats in:** paste · .docx (comes back as real Word, formatting intact) ·
.txt/.md · PDF (text layer via pdf.js; scanned PDFs rendered and OCR'd) ·
photos (.png/.jpg/.webp/.bmp, plus a 📷 Take-a-photo button on touch devices;
phone photo libraries work via image/* MIME intake). OCR reads typed English
print; handwriting is refused with a plain message, HEIC gets a "Most
Compatible" tip, and every OCR'd paper carries a double-check warning.

**Detection layers:** one NER model (English DistilBERT, 64 MB)
+ regex rules (email, phone, SSN, school names in title case and all caps,
and 7–16 digit runs → ID, which closed a real student-ID leak) + boundary
extension (Unicode-aware, so "García Márquez" and "José Peña" extend fully;
CITY/STATE extend too — "Dalton" the first name reads as a city to the model —
but never across a sentence boundary) + name echo. Inference runs in a worker
(`proxy: true`), so the page never freezes mid-scan.

**Tags and the round trip:** tags are batch-wide and belong to values —
the same kid is the same `[NAME 4]` in every paper of a set, numbers never
shift when highlights are toggled, and identity is exact-match only (two
Daltons must never be merged by a guess). Un-scrub boxes on the review screen
(per paper) and the batch screen (whole set) put real names back into AI
replies; the mapping snapshots at copy/download time.

**Trust:** privacy.html (plain-English, forwardable to a principal),
airplane-mode verify line under the trust strip, public-code link in the
footer, feedback address (alex@theholler.org) in the footer, PWA install
button, OG/Twitter tags + social card, WCAG AA contrast pass, keyboard-
accessible review highlights, help dialog behind the floating ? button.

**Service worker lessons already paid for:** cleanup only purges
`paper-scrubber-*` caches (it used to delete the downloaded models on every
update); only `res.ok` responses are cached; updates never reload over open
papers.

**Google Docs add-on:** built as a hand-off bridge in `google-docs-addon/` —
a Docs menu packs the document into a `#gdoc=` URL fragment (fragments never
reach a server) and the app auto-scrubs it, at load and on hashchange.
Deliberately not an in-Docs scrubber: Apps Script can't run the models, and a
regex-only version wearing the name would be worse than none.

## To do

1. ~~**KVEC logo**~~ — done in v58.
2. **Deploy the Docs add-on** — create the Apps Script project at
   script.google.com and paste in the three files; steps and district-rollout
   notes are in `google-docs-addon/README.md` (~10 minutes, needs a Google
   login). Marketplace publishing needs Google's OAuth verification;
   `documents.currentonly` keeps that at the mildest tier.
3. **Real-hardware pass** — five minutes each on a school Chromebook and an
   iPhone: scrub the sample, take a photo of a typed page, try the photo
   library and the Install button. Everything so far was tested in emulation.
4. **IEP deep check — BUILT v42, SPLIT INTO ITS OWN TOOL v43** (Alex's call:
   teachers and the review team get separate tools). Paper Scrubber
   (`index.html`, blue) has no deep check at all; the **De-Identifier**
   (`deid/index.html`, green masthead, own manifest/icons, installs as its own
   app) runs it always-on. One shared app.js: `deid/index.html` has
   `<base href="../">` + `<body data-tool="deid">`, and `deepCheckOn()` is just
   `TOOL === 'deid'`. Zero-shot GLiNER fp16 in a dedicated worker
   (`deep-check-worker.mjs` + `vendor/gliner-bundle.mjs`, esbuild bundle of
   the `gliner` npm package). The 553 MB model lives in the repo as seven
   <100 MB slices (`models/onnx-community/gliner_multi_pii-v1/onnx/*.part*`
   — GitHub's file cap) reassembled in the worker; tokenizer fetches aim at
   our own `models/` via the bundle's exported `xenv`. Deep hits map:
   person→NAME (scrubbed, `looksLikeRealName` filters pronoun/role noise),
   school→ORG (scrubbed, same filter), health/disability/medication/assistive
   device→HEALTH, family relationship→FAMILY, religious group→CHURCH,
   company→WORK, sports team or club→ACTIVITY, government benefit→BENEFIT —
   all the new categories are flagged-not-scrubbed (`DEFAULT_KEPT`).
   Regular findings always win overlaps; `DEEP_FLAG_STOP` drops
   junior/senior-style junk. A deep-check failure degrades to a normal scrub
   with a message, never a dead page. Road-ready check includes the deep
   assets only while the box is ticked. Probe numbers that justified all this:
   - **fp16 (553 MB) works**: ~90% of planted contextual identifiers caught
     sentence-by-sentence at threshold 0.3 (autism 0.73, Adderall 1.00,
     First Baptist Church 0.63, Hensley Auto Parts 0.99, free lunch 0.35,
     grandma/aunt/uncle/sister all caught). ~1.2 s/sentence on a desktop.
   - **int8/quantized (333 MB) is unusable** — ~15% recall, scores collapse
     with input length. Same quantization disease as Piiranha. Do not ship it.
   - **Wrapper gotchas**: labels must be SHORT noun phrases ("health
     condition", not descriptions); multi-text batch calls silently return
     empty — call one text at a time; the gliner npm package's Node path has a
     broken ort binding, browser path works; single-pronoun "person" hits
     ("He", "I") need filtering.
   - Integration sketch: opt-in "IEP deep check" for staff laptops (553 MB
     one-time, minutes per document), findings land as underlined
     flagged-not-scrubbed, same review UX. Long-term: distill — generate
     synthetic IEPs, label them with the fp16 model, fine-tune a 64 MB model
     on the IEP categories. No real student data in training, ever.
5. **Mac desktop edition (v1.1, Aug 2026)** — `desktop/` holds an Electron app;
   `.github/workflows/build-mac.yml` builds it on a real macOS runner and
   publishes the .dmg to GitHub Releases (link: /releases/latest, also in the
   deid web footer). Key facts:
   - **Zero questions, by design.** Alex's field report: the review team avoided
     the scrubber because judgement-call underlines felt like FERPA exposure.
     In the desktop edition (`DESKTOP` in app.js), every detected category is
     scrubbed automatically, safe filenames are forced on and hidden, and the
     copy says "there is nothing you have to do here." Web versions keep flags
     on purpose — different audiences.
   - Both models ship in the bundle (~700 MB dmg); the app serves its own files
     from a loopback-only server so behavior matches the tested web stack.
     No network, ever. SW is skipped in desktop.
   - Scans workflow: "Watch a scans folder…" (fs.watch + 1.5 s settle delay,
     ignores pre-existing files and `-scrubbed` output) + Finder Open With.
   - CI gates: `--smoke` (boots, tool loads, bridge present) and
     `--scrub-test` (a real de-identify inside the packaged app: ≥5 findings,
     0 flagged, 0 leaks incl. ADHD/free lunch/youth group/First Baptist).
     Both also run locally on Windows via `npx electron . --smoke|--scrub-test`
     after assembling `desktop/webapp/` (see the workflow's rsync step).
   - **Ad-hoc signed since 1.3.1** (no Apple Developer cert) — first launch on
     a Mac is System Settings → Privacy & Security → Open Anyway. See v65.
   - Never claim the tool "guarantees FERPA compliance" — the honest claim is
     that identifiers never reach the third-party AI, and that's the wording
     everywhere.
6. **Watch the inbox** — the footer email is the feature pipeline now. A
   foreign-language teacher asking is what brings the multilingual engine and
   the language toggle back (README says what to restore).
7. ~~**Upgrade Electron**~~ — done in desktop 1.4.0 (Electron 43). Electron
   supports only its three newest versions, so plan an upgrade every few
   months: change the pin, then run the release gates, `tests/rule-cases.mjs`
   and `tests/bench.mjs`.
8. **Last audit item: the `#gdoc=` bridge** (the rest were fixed in v79).
   The Docs add-on carries the paper text in the link, and the browser saves
   that link in its history before the page strips it. The fix is to hand the
   text over with postMessage instead, but it can only be tested inside a real
   Google account, and the add-on is not deployed yet. Do it when the add-on
   is (to do 2). Paper Scrubber only; the De-Identifier has no add-on.

**Parked on purpose:** the scrubber.theholler.org domain (Alex chose to stay
on github.io; a pending domain verification sits harmlessly on the GitHub
account — the DNS records needed are in the README's deploy section if this
ever revives. COOP/COEP multithreading no longer needs it: since v65 the
service worker adds those headers for the De-Identifier's page). A downloadable/portable app was considered and rejected:
Chromebooks can't run executables, district policy blocks unsigned binaries,
and the PWA already covers "it's an app."

## Working on a new machine

- Clone: `git clone git@github.com:beadbeed3000/paper-scrubber.git` — needs an
  SSH key on that machine added at github.com/settings/keys.
- Local test server: `node dev-server.mjs 8137` (any static server works; this
  one sets the right MIME types).
- Deploy = push to `main`; GitHub Pages rebuilds in about 40 seconds.
- On Alex's Windows machine pushes go over HTTPS, and Git Credential Manager
  also holds his other GitHub account (beadbeed). Push with
  `git -c credential.username=beadbeed3000 push origin main`.
- **Every deploy must bump `CACHE` in sw.js** (currently v78) or returning
  visitors keep the old version. This is the rule that bites when forgotten —
  it also applies when testing locally, since the dev origin runs the same
  service worker.
- Commit style: plain sentences, the why in the body, no prefixes.
- The models download from huggingface.co on first scrub per origin and are
  cached by transformers.js in `transformers-cache` — don't delete that cache
  in sw.js cleanup, ever.
- Handy in-page test hook: `window.__dev` (set text, read findings, build
  outputs). Detection scores drift slightly run-to-run near the 0.4 threshold
  because of worker float math — borderline findings (assignment dates, famous
  authors) can flicker; real PII sits far above it.

## Decisions not to re-litigate

- The class-roster feature stays removed (README explains).
- Pseudonym identity is exact-match only; never merge partial names.
- OCR keeps its honesty warnings; don't promise handwriting.
- The Docs add-on stays a bridge until browsers give Apps Script something
  better than regex.

## Open observation (Aug 2026, web only)

During the Roberts IEP validation, one snapshot of the web De-Identifier showed
all 40 HEALTH findings flipped from flagged to enabled between two read-only
queries (48 underlined → 8). Not reproducible afterward — repeated
scrub/build/read cycles held state stable — and the desktop edition is immune
by design (it enables everything at detection). Pattern matches a single
synthetic click on the Health legend chip; cause unfound. If a teacher ever
reports "my underlines turned into tags on their own," start here.
