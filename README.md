# Paper Scrubber & the De-Identifier

**Two tools, one engine, one repo.**

- **Paper Scrubber** (`index.html`, blue) — the light teacher tool: scrub student
  essays before pasting them into an AI. One 64 MB model.
- **De-Identifier** (`deid/index.html`, green) — the staff tool for IEPs and eval
  reports: everything the scrubber does, plus a second AI (GLiNER fp16, always on)
  that reads for contextual identifiers — diagnoses, medications, family members,
  churches, employers, teams, benefits — and underlines them for the reviewer's
  neighbor-test judgement. ~650 MB total, one time, built for 16 GB staff laptops.

They share app.js, styles, models, and the service worker. `deid/index.html`
carries `<base href="../">` so every relative path resolves at the shared root,
and `<body data-tool="deid">` is the only switch app.js reads (`TOOL`). Each has
its own manifest and icons, so both install as separate apps side by side.

A free, one-screen web app that lets teachers remove student names and personal
information (PII) from papers **before** pasting them into ChatGPT, Claude, or any
other online AI tool.

**The whole point: nothing ever leaves the teacher's device.** The AI models run
inside the browser (WebAssembly via transformers.js + ONNX Runtime). There is no
server, no account, no upload, no tracking. After first use it works fully offline —
you can demo it in airplane mode.

Questions, bug reports, ideas: [alex@theholler.org](mailto:alex@theholler.org).

## How it works for a teacher

1. Open the link (or the installed app icon).
2. Paste a paper — or drop `.docx` / `.pdf` / `.txt` files, photos, or scans
   anywhere on the page. Files start scrubbing automatically; drop a whole class
   set at once for **batch mode** (per-paper results + "Download all N scrubbed
   papers (one .zip)").
3. The AI ships with the app and is saved on the device automatically on the
   first visit (~100 MB total, from this site's own address — no third party
   is ever contacted). The front page shows “✅ Road-ready” when the device
   can scrub with no internet at all — install it as an app (Chrome/Edge:
   address-bar install icon; Mac Safari: File → Add to Dock) and it's a
   laptop tool for IEP reviews on the road.
4. Check: every name, address, birthdate, email, phone, etc. is highlighted and
   replaced with `[NAME 1]`, `[EMAIL]`, … Click any highlight to put the real word
   back (book characters, historical figures). Category chips toggle whole groups.
   **Neighbor-test categories** — diagnoses/medications (HEALTH) and grade levels
   (GRADE) — come back *underlined, not scrubbed*: an AI usually needs them to be
   useful (an IEP without the diagnosis is pointless), but in a small school they
   can identify a student, so the call belongs to the human. Bus/room numbers
   (ROOM) scrub like any other number. The summary line counts both: "Replaced
   12 · 3 more underlined for your judgement."

   **The deep check lives in the De-Identifier** (`deid/`), where it is always
   on: a second, heavier AI — zero-shot GLiNER fp16, 553 MB one time, running in
   its own worker so the page stays responsive — hunts for what no fixed label
   set covers: diagnoses it's never seen, family members, churches, employers,
   teams and clubs, government benefits ("free lunch" gets flagged as a benefit).
   Everything it finds lands underlined for the reviewer's judgement; names it
   catches that the main model missed are scrubbed. Plan on a few extra minutes
   for a long document. Like everything else it downloads once from this site's
   own address and then works offline. Paper Scrubber deliberately has no trace
   of it — teachers never see a 553 MB decision.
5. **Download Word file** (a real `.docx` with all original formatting — only the
   personal details are replaced), **Copy scrubbed text**, or **Save as .txt**.
6. If the AI's reply mentions or quotes what was scrubbed ("Nice hook,
   `[NAME 1]`!", a quoted sentence, a scrubbed book character), paste the reply
   into the fold-out at the bottom of the review screen — the tags flip back to
   the real words, on-device. Replies with no tags need nothing.

**Tags are consistent across a batch.** The same name, email, or number gets
the same tag in every paper of a set ("Dalton Hall" is `[NAME 4]` everywhere he
appears, in his own paper or a classmate's), so a teacher can hand an AI several
papers at once and it can track who's who — and the batch screen has its own
un-scrub box that works for a reply about any paper in the set, since no tag
means two different things. Matching is by exact text (case-insensitive):
"Dalton" and "Dalton Hall" are different tags on purpose — two Daltons in one
class must never be merged by a guess. Numbers belong to values, not positions,
so toggling a highlight never renumbers the rest.

The whole flow is three steps, spelled out on the page itself: add the papers →
it scrubs each one → check & save. There is no setup and nothing to configure.

**How .docx output works:** the app unzips the Word file in memory, replaces text
only inside `<w:t>` nodes (body, headers, footers, footnotes, comments), and
rezips it. Fonts, spacing, bold/italic, tables — everything else is untouched.
Names split across formatting runs ("**Jas**mine Carter") are still caught,
because detection runs on the assembled text, not run-by-run.

**The container is scrubbed too, and this is not optional.** A .docx carries the
student's name in places no amount of careful reading on the review screen would
reveal: `docProps/core.xml` (`dc:creator`, `dc:title`, `cp:lastModifiedBy`),
`docProps/app.xml` (`Company`, `Manager`), the `w:author` / `w:initials` attributes
on every comment and tracked change, and `word/people.xml`. Before v39 all of that
rode into the file a teacher uploaded to ChatGPT while the app told her it was
clean. `stripDocxIdentity()` blanks those values (rather than deleting the parts,
which would invalidate the package) on every Word download.

**Safe file names** (tick-box, on by default, remembered per device): a file called
`Dalton Hall essay.docx` names the student before the AI reads a word. With the box
ticked each paper saves under its own tag — `NAME-4-scrubbed.docx` — and a batch zip
carries `WHO-IS-WHO — keep this, do not send it.txt` mapping every tag back to a
real student and original filename. That key file is also the first *durable* record
of the tag mapping: until now it lived only in memory and died with the tab.
The tag is taken from the first NAME finding in the paper (the byline, in practice);
if the heuristic picks the teacher's name instead, the key file shows exactly what it
chose and the mapping is still one-to-one. Unticking keeps the original filenames.

**How PDFs work:** text is extracted in the browser with Mozilla's pdf.js
(vendored, ~1.8 MB, loaded only when a PDF arrives, pre-cached for offline).
Typed PDFs — Google Docs and Word exports, which is what students turn in —
read cleanly. The scrubbed result comes back as **plain text** (there is no
practical way to rewrite a PDF with its layout intact in the browser), which
suits the tool's purpose: pasting into an AI. Password-protected and broken
PDFs get clear messages.

**How photos & scans work (OCR):** when a PDF has no text layer, or the file
is an image (`.png` / `.jpg` / `.webp` / `.bmp`), the print is read with
tesseract.js (vendored, ~7 MB with the English model, loaded only when needed,
pre-cached for offline). Scanned PDF pages are rendered to a canvas with
pdf.js first, then read. OCR reads **typed print** well and **handwriting
essentially not at all**, so every OCR'd paper is labeled "read from a photo —
double-check it" in the batch list and carries a warning banner on the review
screen: misread print can hide a name from the detector, and the teacher is
the backstop. Reads English print.
iPhone HEIC photos can't be decoded by most browsers — the app tells the
teacher to use "Most Compatible" camera format or share as JPEG.

## Branding

Styled in the cooperative's colors — mountain blue `#1b5ea8`, ridge green
`#6db544`, warm paper `#f4f1e9` — with the ridgeline motif from the KVEC logo in
the masthead and footer.

**To show the actual KVEC logo in the masthead**, save the logo image into this
folder as `icons/kvec-logo.png`. It appears automatically; if the file is absent
the layout falls back to the "A free tool from KVEC" wordmark with no broken
image. Nothing else needs to change.

## The two engines

| Engine | Model | Size | License |
|---|---|---|---|
| English (the only one) | [distilbert_finetuned_ai4privacy_v2 (ONNX)](https://huggingface.co/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX) | 64 MB | CC BY-NC 4.0 |

A multilingual second engine (`multilang-pii-ner`, 266 MB) and Spanish OCR shipped
for a while and were **removed in August 2026** — Alex's call: the papers are
English, and the language toggle was a decision teachers shouldn't have to make.
Restoring it is a small change (a second `MODELS` entry, the `spa.traineddata.gz`
file, and the toggle markup) if a foreign-language teacher ever asks.

It's a token-classification model trained on ai4privacy data. On top of the
model, `app.js` adds deterministic regex rules (email, US phone, SSN, school names),
boundary extension (models often catch "Jasmine" but not "Carter", or "118" but not
"Deer Creek Road"), and a "name echo" pass: once a name is caught anywhere,
identical words are scrubbed everywhere in the paper. Each of those layers closed a
real leak found in testing.

> **Why not Piiranha?** It was the original plan, but its browser-ready quantized
> build turned out badly degraded in testing (missed obvious names), and the
> full-precision file (1.1 GB) is too big to run in a browser on school hardware.
> `multilang-pii-ner` is newer (trained on ai4privacy's 500k dataset), MIT-licensed,
> smaller, and detected more in side-by-side tests.

## Run it locally

```
node dev-server.mjs 8137
```

Then open http://localhost:8137/. (Any static server works; this one just sets the
correct MIME types for `.mjs`, `.wasm`, and `.webmanifest`.)

## Getting it onto a KVEC address

**Recommended: point a subdomain at GitHub Pages (hosts zero bytes on KVEC servers).**
The trust win is the domain name, not the hosting. One DNS record does it:

1. In theholler.org's DNS, add a `CNAME` record:
   `scrubber` → `beadbeed3000.github.io.`
2. Wait for DNS to resolve (`dig scrubber.theholler.org` shows the CNAME), **then**
   set the custom domain to `scrubber.theholler.org` in the repo's Settings → Pages
   (this creates a `CNAME` file in the repo — don't add that file before DNS is
   live, or the site 404s for everyone in between). Tick "Enforce HTTPS" once the
   certificate is issued (automatic, a few minutes).
3. Done. Same push-to-deploy workflow, automatic HTTPS, the old github.io URL
   redirects to the new address, and KVEC hosts nothing.

Heads-up for the changeover: caches are per-address, so on their next visit
teachers re-download the app and model once at the new address, and anyone who
installed the PWA should reinstall from the new address.

**Alternative: fully self-host on a KVEC server** — the app is 100% static files;
upload this folder and link to it. Sizes, so there are no surprises: the app
folder is **~35 MB** (mostly the AI runtime in `vendor/`). Optionally also
self-host the model (+64 MB) to remove the app's
only third-party request (huggingface.co) — that's the fix if a district
firewall blocks Hugging Face. Requirements and notes:

- **HTTPS is required** (service worker + install button need it). Any normal host
  already has this.
- Serve `.wasm` as `application/wasm` and `.mjs` as `text/javascript`
  (standard hosts do; the dev server shows the exact map).
- Models are fetched from `huggingface.co` on first use and cached in the browser.
  If district firewalls block huggingface.co, self-host the model files instead:
  download the two model repos into a `models/` folder and set
  `env.allowRemoteModels = false; env.localModelPath = './models/'` in `app.js`.
  (Self-hosting also removes the only third-party request the app ever makes.)
- Optional speed boost: send COOP/COEP headers (`Cross-Origin-Opener-Policy:
  same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) to enable
  multi-threaded WASM — roughly 2–4× faster scanning. Only do this alongside
  self-hosted models (the headers restrict cross-origin fetches).
- PWA: with HTTPS, Chrome/Edge show an **Install** icon; teachers get a desktop/
  Chromebook app icon that works offline. No IT install rights needed.

## Licenses / attribution

- Fast engine (`Isotonic/distilbert_finetuned_ai4privacy_v2`): **CC BY-NC 4.0** —
  free non-commercial use with attribution (the footer links it). Fine for a free
  teacher tool; the tool must never be sold while this model is the default.
- Max engine (`Ar86Bat/multilang-pii-ner`): **MIT** — no restrictions.
- transformers.js (Apache-2.0), ONNX Runtime Web (MIT), JSZip (MIT),
  pdf.js 5.7.284 legacy build (Apache-2.0 — the legacy build keeps older
  school Chromebooks working), tesseract.js 6.0.1 + tesseract.js-core
  (Apache-2.0) with the `eng` and `spa` traineddata (Apache-2.0,
  tessdata "best-int").

## Known limits (be honest with teachers)

- No detector catches 100%. The review screen exists for a reason — the app says so.
- Fictional/character names get flagged (models can't know "Scout" is a character);
  that's what click-to-keep is for.
- Old `.doc` files aren't supported — Word's "Save As → .docx" first.
- Photos and scans are read with OCR, which handles **typed print only** —
  handwriting comes back as nonsense, and the app says so. OCR can also misread
  print ("Jasm1ne"), which can hide a name from the detector; that's why OCR'd
  papers get an explicit double-check warning. English print only for now.
- The floating **?** button opens the in-app help: the whole flow in six
  steps plus the good-to-know notes, without leaving the page.

## Google Docs add-on

`google-docs-addon/` holds a tiny bridge add-on: a **Paper Scrubber** menu in
Google Docs that opens this web app with the document's text carried in the
URL fragment — which browsers never send to any server, so the privacy story
is unchanged (the doc already lives in Google; nothing new sees it). The app
side accepts `#gdoc=<base64url JSON {t: title, x: text}>`, strips the fragment
from history immediately, and auto-scrubs. Deployment steps (and the honest
Marketplace-verification caveats) are in that folder's README.

- **Images inside a .docx are left alone.** A photo of the student embedded in the
  paper survives into the download. Deleting `word/media/*` would silently gut the
  student's work, so the tool doesn't; a paper built around a personal photo needs
  the teacher's judgement.

A class-roster feature (paste your class list, always scrub those names) was built
and then **removed on purpose** — it added setup steps for teachers, and testing
showed the models already catch those names unaided. Don't re-add it without
evidence that real papers are being missed.
