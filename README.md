# Paper Scrubber

A free, one-screen web app that lets teachers remove student names and personal
information (PII) from papers **before** pasting them into ChatGPT, Claude, or any
other online AI tool.

**The whole point: nothing ever leaves the teacher's device.** The AI models run
inside the browser (WebAssembly via transformers.js + ONNX Runtime). There is no
server, no account, no upload, no tracking. After first use it works fully offline —
you can demo it in airplane mode.

## How it works for a teacher

1. Open the link (or the installed app icon).
2. Paste a paper — or drop `.docx` / `.txt` files anywhere on the page.
   Files start scrubbing automatically; drop a whole class set at once for
   **batch mode** (per-paper results + "Download all N scrubbed papers (one .zip)").
3. First use downloads the AI once (64 MB English engine); after that it's
   stored on the device and works offline.
4. Check: every name, address, birthdate, email, phone, etc. is highlighted and
   replaced with `[NAME 1]`, `[EMAIL]`, … Click any highlight to put the real word
   back (book characters, historical figures). Category chips toggle whole groups.
5. **Download Word file** (a real `.docx` with all original formatting — only the
   personal details are replaced), **Copy scrubbed text**, or **Save as .txt**.

The whole flow is three steps, spelled out on the page itself: add the papers →
it scrubs each one → check & save. There is no setup and nothing to configure.

**How .docx output works:** the app unzips the Word file in memory, replaces text
only inside `<w:t>` nodes (body, headers, footers, footnotes, comments), and
rezips it. Fonts, spacing, bold/italic, tables — everything else is untouched.
Names split across formatting runs ("**Jas**mine Carter") are still caught,
because detection runs on the assembled text, not run-by-run.

## Branding

Styled in the cooperative's colors — mountain blue `#1b5ea8`, ridge green
`#6db544`, warm paper `#f4f1e9` — with the ridgeline motif from the KVEC logo in
the masthead and footer.

**To show the actual KVEC logo in the masthead**, save the logo image into this
folder as `icons/kvec-logo.png`. It appears automatically; if the file is absent
the layout falls back to the "A free tool from KVEC" wordmark with no broken
image. Nothing else needs to change.

## The two engines

| Engine | Model | Size | License | Notes |
|---|---|---|---|---|
| Fast · English (default) | [distilbert_finetuned_ai4privacy_v2 (ONNX)](https://huggingface.co/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX) | 64 MB | CC BY-NC 4.0 | Best for most papers |
| Max accuracy · multilingual | [multilang-pii-ner (ONNX)](https://huggingface.co/onnx-community/multilang-pii-ner-ONNX) | 266 MB | MIT | XLM-RoBERTa; trained on EN/DE/IT/FR, handled Spanish well in testing |

Both are token-classification models trained on ai4privacy datasets. On top of the
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

## Deploying to theholler.org / a KVEC site

The app is 100% static files — upload this folder to any web host and link to it,
e.g. `https://theholler.org/scrubber/`. Requirements and notes:

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
- transformers.js (Apache-2.0), ONNX Runtime Web (MIT), mammoth.js (BSD-2).

## Known limits (be honest with teachers)

- No detector catches 100%. The review screen exists for a reason — the app says so.
- Fictional/character names get flagged (models can't know "Scout" is a character);
  that's what click-to-keep is for.
- Old `.doc` files aren't supported — Word's "Save As → .docx" first.
- Text inside images (scanned/photographed papers) is not read. Roadmap idea: OCR.
- Other roadmap ideas: per-student consistent pseudonyms ("Student A") across a
  whole batch, Google Docs add-on, printable one-page teacher guide.

A class-roster feature (paste your class list, always scrub those names) was built
and then **removed on purpose** — it added setup steps for teachers, and testing
showed the models already catch those names unaided. Don't re-add it without
evidence that real papers are being missed.
