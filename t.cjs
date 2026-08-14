const path='C:/Users/Holler2/Documents/Claude/Projects/ClaudeCode/paper-scrubber/vendor/jszip.min.js';
const JSZip=require(path);
(async()=>{
  const z=new JSZip();
  z.file('docProps/core.xml','<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>Jasmine Carter</dc:creator><cp:lastModifiedBy>Jasmine Carter</cp:lastModifiedBy></cp:coreProperties>');
  z.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>My name is Jasmine Carter.</w:t></w:r></w:p><w:p><w:del w:author="Jasmine Carter"><w:r><w:delText>I live at 118 Deer Creek Road.</w:delText></w:r></w:del></w:p></w:body></w:document>');
  z.file('word/comments.xml','<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1" w:author="Jasmine Carter" w:initials="JC"><w:p><w:r><w:t>fix this</w:t></w:r></w:p></w:comment></w:comments>');
  const buf=await z.generateAsync({type:'nodebuffer'});
  // now mimic the app: load, overwrite ONLY word/document.xml, regenerate
  const z2=await JSZip.loadAsync(buf);
  console.log('entries after loadAsync:',Object.keys(z2.files));
  z2.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>My name is [NAME 1].</w:t></w:r></w:p></w:body></w:document>');
  const out=await z2.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const z3=await JSZip.loadAsync(out);
  console.log('--- docProps/core.xml in OUTPUT ---');
  console.log(await z3.file('docProps/core.xml').async('string'));
  console.log('--- word/comments.xml in OUTPUT ---');
  console.log(await z3.file('word/comments.xml').async('string'));
})();
