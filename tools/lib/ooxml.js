// Minimal WordprocessingML writer: enough to produce a readable .docx with
// headings, colour, shading and real hyperlinks, and nothing more.
//
// A .docx is a zip of XML parts. Four matter: the content-type map, the package
// relationships, the document body, and the relationships that turn a hyperlink
// into a link rather than blue text. Zipped with the system `zip`, so this adds
// no dependency to the app.
//
// (tools/review/docx.js predates this module and still carries its own copy;
// worth folding in next time that file is touched.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Word refuses to open a document containing raw control characters.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function createDoc() {
  const rels = [];

  function run(text, o) {
    o = o || {};
    const p = [];
    if (o.font) p.push(`<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}"/>`);
    if (o.b) p.push('<w:b/>');
    if (o.i) p.push('<w:i/>');
    if (o.caps) p.push('<w:smallCaps/>');
    if (o.color) p.push(`<w:color w:val="${o.color}"/>`);
    if (o.sz) p.push(`<w:sz w:val="${o.sz * 2}"/><w:szCs w:val="${o.sz * 2}"/>`);
    const rPr = p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  function para(runs, o) {
    o = o || {};
    const p = [];
    if (o.style) p.push(`<w:pStyle w:val="${o.style}"/>`);
    const sp = [];
    if (o.before != null) sp.push(`w:before="${o.before}"`);
    if (o.after != null) sp.push(`w:after="${o.after}"`);
    if (sp.length) p.push(`<w:spacing ${sp.join(' ')}/>`);
    if (o.indent) p.push(`<w:ind w:left="${o.indent}"/>`);
    if (o.bar) p.push(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${o.bar}"/></w:pBdr>`);
    if (o.shade) p.push(`<w:shd w:val="clear" w:fill="${o.shade}"/>`);
    if (o.numbered) p.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    const pPr = p.length ? `<w:pPr>${p.join('')}</w:pPr>` : '';
    return `<w:p>${pPr}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
  }

  function hyperlink(label, url, o) {
    o = o || {};
    const id = 'rIdL' + (rels.length + 1);
    rels.push({ id, url });
    return `<w:hyperlink r:id="${id}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>` +
      `<w:sz w:val="${(o.sz || 9) * 2}"/><w:szCs w:val="${(o.sz || 9) * 2}"/></w:rPr>` +
      `<w:t xml:space="preserve">${esc(label)}</w:t></w:r></w:hyperlink>`;
  }

  function write(body, outPath, styles) {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

    const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(r.url)}" TargetMode="External"/>`).join('\n')}
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ooxml-'));
    fs.mkdirSync(path.join(tmp, '_rels'));
    fs.mkdirSync(path.join(tmp, 'word'));
    fs.mkdirSync(path.join(tmp, 'word', '_rels'));
    fs.writeFileSync(path.join(tmp, '[Content_Types].xml'), contentTypes);
    fs.writeFileSync(path.join(tmp, '_rels', '.rels'), packageRels);
    fs.writeFileSync(path.join(tmp, 'word', 'document.xml'), documentXml);
    fs.writeFileSync(path.join(tmp, 'word', 'styles.xml'), styles);
    fs.writeFileSync(path.join(tmp, 'word', '_rels', 'document.xml.rels'), documentRels);

    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    execFileSync('zip', ['-q', '-X', '-r', path.resolve(outPath), '.'], { cwd: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
    return { bytes: fs.statSync(outPath).size, links: rels.length };
  }

  return { run, para, hyperlink, write };
}

const DEFAULT_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
    <w:sz w:val="20"/><w:szCs w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="0E5A62"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="360" w:after="120"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="0E5A62"/></w:pBdr></w:pPr>
    <w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="0E5A62"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="280" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0E5A62"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;

module.exports = { createDoc, DEFAULT_STYLES, esc };
