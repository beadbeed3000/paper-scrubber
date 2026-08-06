# Working on Paper Scrubber

Read `STATUS.md` first — it holds where the work stands, the to-do list, and
the decisions already made. The README covers the product and architecture.

Rules that matter here:

- **Bump `CACHE` in sw.js on every change you deploy or test** — the
  service worker is cache-first, so without a bump neither production visitors
  nor your localhost test run gets the new code. This bites constantly.
- Deploy = push to `main` (GitHub Pages, ~40 s rebuild). Verify with
  `curl -s https://beadbeed3000.github.io/paper-scrubber/sw.js | grep CACHE`.
- Test against the real app before committing: `node dev-server.mjs 8137`,
  then use `window.__dev` in the page (set text, read findings, build the
  docx/zip outputs). Synthetic drops via `DataTransfer` work for files.
- Never let sw.js cleanup touch `transformers-cache` — that's the teachers'
  downloaded 64–266 MB models.
- Privacy is the product: nothing may send paper text anywhere, new vendor
  libraries get vendored into `vendor/` (no CDNs at runtime), and any feature
  that can't keep "nothing leaves this device" true doesn't ship.
- Commit messages are plain sentences with the why in the body, ending with
  the Claude co-author trailer.
- Alex's contact for the tool is alex@theholler.org; the GitHub account is
  beadbeed3000, and pushes use SSH.
