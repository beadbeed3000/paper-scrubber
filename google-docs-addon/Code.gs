/**
 * Paper Scrubber — Google Docs add-on (hand-off bridge).
 *
 * Adds a "Paper Scrubber" menu to Google Docs. "Scrub this paper…" packs the
 * document's text into a URL *fragment* (the part after #) and opens the
 * Paper Scrubber web app with it. Fragments are never sent to any server —
 * the paper travels straight from this Doc into the teacher's own browser
 * tab, where all the AI scrubbing runs on-device as usual.
 *
 * Scopes are the narrowest possible: read the CURRENT document only, and
 * show a small dialog. The add-on itself never stores, sends, or logs
 * anything.
 */

const SCRUBBER_URL = 'https://beadbeed3000.github.io/paper-scrubber/';

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Paper Scrubber')
    .addItem('Scrub this paper…', 'openScrubber')
    .addToUi();
}

function openScrubber() {
  const doc = DocumentApp.getActiveDocument();
  const payload = JSON.stringify({ t: doc.getName(), x: doc.getBody().getText() });
  const b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes());
  const template = HtmlService.createTemplateFromFile('Dialog');
  template.url = SCRUBBER_URL + '#gdoc=' + b64;
  DocumentApp.getUi().showModalDialog(
    template.evaluate().setWidth(380).setHeight(190),
    'Paper Scrubber',
  );
}
