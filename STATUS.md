# Paper Scrubber — status and to-do

Working notes so this project can be picked up from any machine. The README
covers what the tool is and how it works; this file covers where the work
stands. Last updated August 2026, live version `paper-scrubber-v37`.

## Where things stand

Everything below is shipped and live at
https://beadbeed3000.github.io/paper-scrubber/ (all tested against the running
app before each push).

**Formats in:** paste · .docx (comes back as real Word, formatting intact) ·
.txt/.md · PDF (text layer via pdf.js; scanned PDFs rendered and OCR'd) ·
photos (.png/.jpg/.webp/.bmp, plus a 📷 Take-a-photo button on touch devices;
phone photo libraries work via image/* MIME intake). OCR reads typed print in
English, and Spanish when the multilingual mode is selected; handwriting is
refused with a plain message, HEIC gets a "Most Compatible" tip, and every
OCR'd paper carries a double-check warning.

**Detection layers:** two NER models (English DistilBERT 64 MB default,
multilingual XLM-R 266 MB) + regex rules (email, phone, SSN, school names,
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
4. **Watch the inbox** — the footer email is the feature pipeline now. French
   OCR is a one-line language addition plus ~2 MB `fra.traineddata.gz` if a
   French teacher asks.

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
