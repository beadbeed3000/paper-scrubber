# Paper Scrubber — Google Docs add-on

A tiny bridge, not a second scrubber: it adds a **Paper Scrubber** menu to
Google Docs whose one item packs the current document's text into a URL
*fragment* and opens the real Paper Scrubber web app. Fragments (`#…`) are
never sent to any server, so the paper travels straight from the Doc into the
teacher's browser tab — where the models, review screen, and un-scrub box
already live and already work offline. The add-on itself stores, sends, and
logs nothing, and asks for the two narrowest scopes that exist: *read the
current document only* and *show a dialog*.

Why a bridge instead of scrubbing inside Docs: Apps Script runs on Google's
servers and can't run the AI models (no WASM), so an "in-Docs" scrubber would
be a weaker regex-only tool wearing the same name. The bridge keeps one real
scrubber.

## Deploying it (Alex, ~10 minutes)

1. Go to **script.google.com** (logged in as the account that should own it —
   ideally a KVEC Workspace account, not a personal Gmail) → **New project**.
2. Name it "Paper Scrubber".
3. Replace the default `Code.gs` with this folder's `Code.gs`. Add a new
   **HTML file** named `Dialog` and paste in `Dialog.html`.
4. Project Settings (gear icon) → check **"Show 'appsscript.json' manifest
   file"** → replace its contents with this folder's `appsscript.json`.
5. Test it: **Deploy → Test deployments → Install** (legacy editor add-on
   test), or open any Google Doc you own after adding the script via
   Extensions → Apps Script won't attach it doc-wide — the reliable test path
   is Deploy → **Test deployments** → select a Doc → Execute. First run asks
   for authorization (the two scopes above).
6. You should see a **Paper Scrubber** menu in that Doc; "Scrub this paper…"
   opens the dialog, and the button opens the scrubber with the text loaded
   and scrubbing.

## Getting it to teachers

- **Same Workspace domain (KVEC staff):** Deploy → New deployment → Add-on,
  then a Workspace admin installs it domain-wide from the Admin console
  (Apps → Marketplace apps → domain install of the private deployment).
- **Other districts:** each district's Workspace admin does the same with the
  shared script, **or** publish once to the Google Workspace Marketplace as
  "private/unlisted". Note: Marketplace publishing — even unlisted — requires
  a Google Cloud project, an OAuth consent screen, and Google's verification
  review (privacy policy URL, a few weeks of patience). The
  `documents.currentonly` scope is non-sensitive, which keeps that review at
  its mildest tier.
- The zero-install fallback always works: select all → copy → paste into the
  web app. The add-on saves clicks; it doesn't gate anything.

## Size note

The hand-off link carries the document text (base64, roughly 1.4× the text
size). A typical 5-page paper is ~15 KB of text → ~20 KB link — trivial.
Extremely long documents (hundreds of pages) could hit browser URL limits;
for those, File → Download → .docx and drop the file into the web app.
