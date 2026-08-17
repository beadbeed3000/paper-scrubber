# Paper Scrubber — status and to-do

Working notes so this project can be picked up from any machine. The README
covers what the tool is and how it works; this file covers where the work
stands. Last updated August 2026, live version `paper-scrubber-v40`.

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

**Known and deliberately not fixed:** images inside a .docx are left intact
(deleting `word/media/*` would gut the student's work). Also seen in testing: when
the model labels a person as ADDRESS/CITY rather than NAME, that person gets a
different tag in that paper than in one where it read NAME — still scrubbed, never
leaked, but the key file reads oddly. Worth a look; identity is type-scoped today.

## Where things stand

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

1. **KVEC logo** — drop the real file at `icons/kvec-logo.png` and push
   (with a `CACHE` bump in sw.js). It's the only 404 on the site; the layout
   already handles it appearing.
2. **Deploy the Docs add-on** — create the Apps Script project at
   script.google.com and paste in the three files; steps and district-rollout
   notes are in `google-docs-addon/README.md` (~10 minutes, needs a Google
   login). Marketplace publishing needs Google's OAuth verification;
   `documents.currentonly` keeps that at the mildest tier.
3. **Real-hardware pass** — five minutes each on a school Chromebook and an
   iPhone: scrub the sample, take a photo of a typed page, try the photo
   library and the Install button. Everything so far was tested in emulation.
4. **IEP deep check — BUILT, v42** (probed then shipped August 2026; Alex's
   team runs 16 GB staff laptops). Opt-in checkbox on the input view, off by
   default. Zero-shot GLiNER fp16 in a dedicated worker
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
5. **Watch the inbox** — the footer email is the feature pipeline now. A
   foreign-language teacher asking is what brings the multilingual engine and
   the language toggle back (README says what to restore).
5. **Remaining audit items, none of them leaks** — dead escape-hatch buttons
   during a batch run, the aria-live summary written while hidden so it's never
   announced, focus rings too faint to see (1.2–1.5:1), all-or-nothing offline
   precache that fails silently, and the `#gdoc=` bridge writing paper text into
   browser history. Worth a pass; nothing here sends a student's name anywhere.

**Parked on purpose:** the scrubber.theholler.org domain (Alex chose to stay
on github.io; a pending domain verification sits harmlessly on the GitHub
account — the DNS records needed are in the README's deploy section if this
ever revives, and self-hosting models + COOP/COEP multithreading only make
sense alongside it). A downloadable/portable app was considered and rejected:
Chromebooks can't run executables, district policy blocks unsigned binaries,
and the PWA already covers "it's an app."

## Working on a new machine

- Clone: `git clone git@github.com:beadbeed3000/paper-scrubber.git` — needs an
  SSH key on that machine added at github.com/settings/keys.
- Local test server: `node dev-server.mjs 8137` (any static server works; this
  one sets the right MIME types).
- Deploy = push to `main`; GitHub Pages rebuilds in about 40 seconds.
- **Every deploy must bump `CACHE` in sw.js** (currently v37) or returning
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
