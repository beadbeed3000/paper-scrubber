// Rebuilds the synthetic Word test records from an answer key, plus the
// hidden-parts file. Usage: node tests/make-testfiles.cjs tests/keys/tuning.json tests/files/tuning
const JSZip = require(require('path').join(__dirname, '..', 'vendor', 'jszip.min.js'));
const fs = require('fs');
const path = require('path');
const [, , keyPath, outDir] = process.argv;
const docs = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const CT = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${extra}</Types>`;
const RELS = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>${extra}</Relationships>`;
const core = (title, who) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(who)}</dc:creator><cp:lastModifiedBy>${esc(who)}</cp:lastModifiedBy></cp:coreProperties>`;
const app = (title) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Company>Hollin County Schools</Company><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${esc(title)}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`;
const para = (line) => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;

(async () => {
  const manifest = [];
  for (const d of docs) {
    const student = (d.identifiers.find((x) => x.category === 'name' && /\s/.test(x.text) && x.text !== x.text.toUpperCase()) || d.identifiers[0]).text;
    const kind = { 'psych-eval': 'Psych Eval', 'speech-eval': 'Speech Eval', 'fba-bip': 'FBA-BIP', 'transition-iep': 'Transition IEP', 'arc-notes': 'ARC Notes' }[d.key] || d.key;
    const file = `${student} ${kind}.docx`;
    const z = new JSZip();
    z.file('[Content_Types].xml', CT());
    z.file('_rels/.rels', RELS());
    z.file('docProps/core.xml', core(`${student} ${kind}`, student));
    z.file('docProps/app.xml', app(`${student} ${kind}`));
    z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${d.text.split('\n').map(para).join('')}</w:body></w:document>`);
    fs.writeFileSync(path.join(outDir, file), await z.generateAsync({ type: 'nodebuffer' }));
    manifest.push({ key: d.key, file, student });
  }

  // every hidden hiding place the v51/v57 fixes claim to close, in one file
  const z = new JSZip();
  z.file('[Content_Types].xml', CT('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>'));
  z.file('_rels/.rels', RELS('<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'));
  z.file('docProps/core.xml', core('Hunter Mullins IEP draft', 'Hunter Mullins'));
  z.file('docProps/app.xml', app('Hunter Mullins IEP draft'));
  z.file('docProps/custom.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Student"><vt:lpwstr>Hunter Mullins</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Case Manager"><vt:lpwstr>Faith Hensley</vt:lpwstr></property></Properties>');
  z.file('word/people.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Faith Hensley"/></w15:people>');
  z.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}><w:comment w:id="1" w:author="Faith Hensley" w:initials="FH"><w:p><w:r><w:t>Check with Hunter's mamaw about the bus</w:t></w:r></w:p></w:comment></w:comments>`);
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:hunter.mullins@example.org" TargetMode="External"/><Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>');
  const body = [
    para('Present Levels of Performance - DRAFT'),
    '<w:p><w:r><w:t xml:space="preserve">Student: </w:t></w:r><w:del w:id="9" w:author="Faith Hensley"><w:r><w:delText>Hunter Mullins</w:delText></w:r></w:del><w:ins w:id="10" w:author="Faith Hensley"><w:r><w:t>Hunter J. Mullins</w:t></w:r></w:ins></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Parent email: </w:t></w:r><w:hyperlink r:id="rIdL1"><w:r><w:t>hunter.mullins@example.org</w:t></w:r></w:hyperlink></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Mom: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:brooke.mul</w:instrText></w:r><w:r><w:instrText xml:space="preserve">lins82@example.com" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>brooke.mullins82@example.com</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Papaw: </w:t></w:r><w:fldSimple w:instr=" HYPERLINK &quot;mailto:dwight.combs@example.com&quot; "><w:r><w:t>dwight.combs@example.com</w:t></w:r></w:fldSimple></w:p>',
    '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><wp:docPr id="1" name="Picture 1" descr="Photo of Hunter Mullins at the 4-H goat show"/></wp:inline></w:drawing></w:r></w:p>',
    para('Hunter is a 7th grader at Upper Bearpen Middle School with ADHD. He rides Bus 14 and shows goats in 4-H.'),
    para('Call his mother Brooke at (606) 555-0198.'),
  ].join('');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  fs.writeFileSync(path.join(outDir, 'Hunter Mullins IEP draft.docx'), await z.generateAsync({ type: 'nodebuffer' }));
  manifest.push({ key: 'hidden-parts', file: 'Hunter Mullins IEP draft.docx' });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(manifest.map((m) => m.file).join('\n'));
})();
