// Self-contained minimal DOCX Resume Builder — no external dependencies
// Same ZIP approach as xlsxbuilder.js — a .docx is just a ZIP of XML files
// Usage: const bytes = window.buildResumeDocx(profile, resumeText, templateId);

window.buildResumeDocx = function(profile, resumeText, templateId = 'standard') {
  'use strict';

  const enc = new TextEncoder();

  function escXml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // ── PARSE RESUME TEXT FOR [TAGS] ──
  function parseContent(raw) {
    if (!raw) return { summary: '', skills: '', experience: '', education: '' };
    const sTag = /\[(?:professional\s+)?summary\]/i;
    const kTag = /\[(?:technical\s+)?skills\]/i;
    const eTag = /\[(?:professional\s+)?experience\]/i;
    const edTag = /\[education\]/i;
    const summaryMatch = raw.match(new RegExp(sTag.source + '([\\s\\S]*?)(?=' + kTag.source + '|' + eTag.source + '|' + edTag.source + '|$)', 'i'));
    const skillsMatch = raw.match(new RegExp(kTag.source + '([\\s\\S]*?)(?=' + sTag.source + '|' + eTag.source + '|' + edTag.source + '|$)', 'i'));
    const expMatch = raw.match(new RegExp(eTag.source + '([\\s\\S]*?)(?=' + sTag.source + '|' + kTag.source + '|' + edTag.source + '|$)', 'i'));
    const edMatch = raw.match(new RegExp(edTag.source + '([\\s\\S]*?)(?=' + sTag.source + '|' + kTag.source + '|' + eTag.source + '|$)', 'i'));
    return {
      summary: summaryMatch ? summaryMatch[1].trim() : '',
      skills: skillsMatch ? skillsMatch[1].trim() : '',
      experience: expMatch ? expMatch[1].trim() : '',
      education: edMatch ? edMatch[1].trim() : '',
    };
  }

  const { summary, skills, experience, education: resumeEdu } = parseContent(resumeText);
  const p = profile || {};
  const pName = p.name || 'User Name';
  const pTitle = p.title || '';
  const pEmail = p.email || '';
  const pPhone = p.phone || '';
  const pLoc = p.location || '';
  const pLink = p.linkedin || '';
  const pEdu = p.education || resumeEdu || '';
  const pCerts = p.certs || '';

  const hyperlinks = [];
  let hyperlinkId = 1;
  function addHyperlink(url) {
    const rId = 'rId' + hyperlinkId++;
    hyperlinks.push({ rId, url });
    return rId;
  }

  // ── TEMPLATE PARAMETERS ──
  const isP2P = templateId === 'p2p_vinay';
  const FONT = isP2P ? 'Times New Roman' : 'Arial';
  const BODY_SIZE = isP2P ? 20 : 21;
  const NAME_SIZE = 36;
  const HEADING_SIZE = isP2P ? 20 : 22;
  const BULLET_CHAR = isP2P ? '·' : '-';

  function makeParagraph(opts) {
    const { text, bold, italic, size, font, align, spacing, border, bullet, tab, children, color } = opts || {};
    let pPr = '';
    if (align) pPr += `<w:jc w:val="${align}"/>`;
    if (spacing) {
      const before = spacing.before || 0;
      const after = spacing.after || 0;
      pPr += `<w:spacing w:before="${before}" w:after="${after}" w:line="${isP2P ? 240 : 276}" w:lineRule="auto"/>`;
    }
    if (border) {
      pPr += `<w:pBdr><w:bottom w:val="single" w:sz="${isP2P ? 6 : 6}" w:space="${isP2P ? 2 : 4}" w:color="${isP2P ? 'AAAAAA' : '000000'}"/></w:pBdr>`;
    }
    if (bullet) {
      pPr += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`;
    }
    if (tab) {
      pPr += `<w:tabs><w:tab w:val="right" w:pos="${isP2P ? 10080 : 10800}"/></w:tabs>`;
    }

    let runs = '';
    if (children && children.length) {
      runs = children.map(c => makeRun(c)).join('');
    } else if (text !== undefined) {
      runs = makeRun({ text, bold, italic, size: size || BODY_SIZE, font: font || FONT, color });
    }

    return `<w:p>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${runs}</w:p>`;
  }

  function makeRun(opts) {
    const { text, bold, italic, size, font, tab, color } = opts || {};
    if (tab) return `<w:r><w:tab/></w:r>`;
    let rPr = `<w:rFonts w:ascii="${font || FONT}" w:hAnsi="${font || FONT}" w:cs="${font || FONT}"/>`;
    if (size) rPr += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    if (bold) rPr += `<w:b/><w:bCs/>`;
    if (italic) rPr += `<w:i/><w:iCs/>`;
    if (color) rPr += `<w:color w:val="${color}"/>`;
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(text || '')}</w:t></w:r>`;
  }

  function makeHyperlink(text, url, rId, size) {
    const rPr = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
      `<w:sz w:val="${size || BODY_SIZE}"/><w:szCs w:val="${size || BODY_SIZE}"/>` +
      `<w:color w:val="0563C1"/><w:u w:val="single"/>`;
    return `<w:hyperlink r:id="${rId}"><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:hyperlink>`;
  }

  let bodyHtml = '';

  if (isP2P) {
    bodyHtml += makeParagraph({ tab: true, spacing: { before: 0, after: 40 }, children: [{ text: pName, bold: true, size: NAME_SIZE }, { tab: true }, { text: pPhone, color: '111111', size: 18 }] });
    bodyHtml += makeParagraph({ tab: true, spacing: { before: 0, after: 40 }, children: [{ text: pTitle, italic: true, color: '555555', size: 22 }, { tab: true }, { text: pEmail, color: '2B2B2B', size: 18 }] });
    bodyHtml += makeParagraph({ tab: true, spacing: { before: 0, after: 120 }, children: [{ text: pLoc, italic: true, color: '888888', size: 20 }, { tab: true }, { text: pLink, color: '2B2B2B', size: 18 }] });

    const sections = [{ h: 'PROFESSIONAL SUMMARY', b: summary }, { h: 'TECHNICAL SKILLS', b: skills }, { h: 'PROFESSIONAL EXPERIENCE', b: experience }, { h: 'EDUCATION', b: pEdu }, { h: 'CERTIFICATIONS', b: pCerts }];
    sections.forEach(s => {
      if (!s.b) return;
      bodyHtml += makeParagraph({ text: s.h, bold: true, size: HEADING_SIZE, border: true, spacing: { before: 200, after: 80 } });
      if (s.h.includes('EXPERIENCE')) {
        s.b.split('\n').map(l => l.trim()).filter(l => l).forEach(line => {
          const parts = line.split('|').map(x => x.trim()).filter(x => x);
          const clean = line.replace(/^[\-•\s\*]+/, '').trim();
          if (parts.length >= 2) {
            bodyHtml += makeParagraph({ tab: true, spacing: { before: 100, after: 20 }, children: [{ text: parts[0].toUpperCase(), bold: true, size: 17 }, { tab: true }, { text: parts[parts.length - 1], italic: true, color: '555555', size: 17 }] });
            const mid = parts.slice(1, -1);
            if (mid.length > 0) bodyHtml += makeParagraph({ text: mid.join(' | '), bold: true, color: '2B2B2B', size: 17, spacing: { after: 40 } });
          } else if (clean.toLowerCase().startsWith('key achievements')) { bodyHtml += makeParagraph({ text: clean, bold: true, size: 17, spacing: { before: 80, after: 20 } }); } else if (clean) { bodyHtml += makeParagraph({ text: clean, bullet: true, spacing: { before: 0, after: 30 } }); }
        });
      } else if (s.h.includes('SKILLS')) {
        s.b.split('\n').filter(l => l.trim()).forEach(l => {
          const idx = l.indexOf(':');
          if (idx > -1) { bodyHtml += makeParagraph({ spacing: { after: 40 }, children: [{ text: l.substring(0, idx + 1), bold: true }, { text: l.substring(idx + 1) }] }); } else bodyHtml += makeParagraph({ text: l, spacing: { after: 40 } });
        });
      } else if (s.h.includes('EDUCATION')) {
        s.b.split('\n').map(l => l.trim()).filter(l => l).forEach(line => {
          const parts = line.split('|').map(x => x.trim()).filter(x => x);
          if (parts.length >= 2) {
            bodyHtml += makeParagraph({ tab: true, spacing: { before: 100, after: 20 }, children: [{ text: parts[0], bold: true, size: 17 }, { tab: true }, { text: parts[parts.length - 1], italic: true, color: '555555', size: 17 }] });
            const mid = parts.slice(1, -1);
            if (mid.length > 0) bodyHtml += makeParagraph({ text: mid.join(' | '), size: 17, color: '555555', spacing: { after: 40 } });
          } else bodyHtml += makeParagraph({ text: line, spacing: { after: 40 } });
        });
      } else { s.b.split('\n').filter(l => l.trim()).forEach(l => { bodyHtml += makeParagraph({ text: l.replace(/^[\-•\s\*]+/, ''), bullet: s.h.includes('CERT'), spacing: { after: 40 } }); }); }
    });
  } else {
    bodyHtml += makeParagraph({ align: 'center', spacing: { after: 40 }, children: [{ text: pName, bold: true, size: NAME_SIZE }] });
    if (pTitle) bodyHtml += makeParagraph({ align: 'center', spacing: { after: 60 }, children: [{ text: pTitle, size: 22 }] });
    const contactParts = [pEmail, pPhone, pLoc].filter(x => x);
    if (contactParts.length) {
      const runs = [];
      contactParts.forEach((part, idx) => { runs.push({ text: part }); if (idx < contactParts.length - 1) runs.push({ text: '  |  ' }); });
      bodyHtml += makeParagraph({ align: 'center', spacing: { after: 20 }, children: runs });
    }
    if (pLink) {
      const rId = addHyperlink(pLink.startsWith('http') ? pLink : 'https://' + pLink);
      bodyHtml += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>${makeHyperlink(pLink, pLink, rId, BODY_SIZE)}</w:p>`;
    }
    const sections = [{ h: 'PROFESSIONAL SUMMARY', b: summary }, { h: 'TECHNICAL SKILLS', b: skills }, { h: 'WORK EXPERIENCE', b: experience }, { h: 'EDUCATION', b: pEdu }, { h: 'CERTIFICATIONS', b: pCerts }];
    sections.forEach(s => {
      if (!s.b) return;
      bodyHtml += makeParagraph({ text: s.h.toUpperCase(), bold: true, border: true, spacing: { before: 120, after: 40 } });
      if (s.h.includes('EXPERIENCE')) {
        s.b.split('\n').filter(l => l.trim()).forEach(l => {
          if (l.includes('|')) {
            const parts = l.split('|').map(p => p.trim());
            bodyHtml += makeParagraph({ tab: true, spacing: { before: 120, after: 20 }, children: [{ text: parts[0] || '', bold: true, size: 22 }, { tab: true }, { text: parts[3] || '', italic: true }] });
            bodyHtml += makeParagraph({ spacing: { after: 40 }, children: [{ text: (parts[1] || '') + (parts[2] ? ' | ' + parts[2] : ''), italic: true }] });
          } else bodyHtml += makeParagraph({ text: l.replace(/^[-•*]\s*/, ''), bullet: true, spacing: { before: 20, after: 20 } });
        });
      } else if (s.h.includes('SKILLS')) {
        s.b.split('\n').filter(l => l.trim()).forEach(l => {
          const idx = l.indexOf(':');
          if (idx > -1) { bodyHtml += makeParagraph({ spacing: { before: 30, after: 30 }, children: [{ text: l.substring(0, idx + 1), bold: true }, { text: l.substring(idx + 1) }] }); } else bodyHtml += makeParagraph({ text: l, spacing: { before: 30, after: 30 } });
        });
      } else { s.b.split('\n').filter(l => l.trim()).forEach(l => { bodyHtml += makeParagraph({ text: l.replace(/^[\-•\s\*]+/, ''), bullet: s.h.includes('EDU') || s.h.includes('CERT'), spacing: { after: 20 } }); }); }
    });
  }

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLET_CHAR}"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="480" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyHtml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="${isP2P ? 792 : 720}" w:right="${isP2P ? 936 : 720}" w:bottom="${isP2P ? 792 : 720}" w:left="${isP2P ? 936 : 720}"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="${BODY_SIZE}"/><w:szCs w:val="${BODY_SIZE}"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  let docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;
  hyperlinks.forEach(h => { docRels += `<Relationship Id="${h.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(h.url)}" TargetMode="External"/>`; });
  docRels += `</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;

  function buildZip(files) {
    function writeUint16LE(dv, offset, val) { dv.setUint16(offset, val, true); }
    function writeUint32LE(dv, offset, val) { dv.setUint32(offset, val, true); }
    function crc32(buf) {
      let c = 0xFFFFFFFF;
      if (!crc32._t) { crc32._t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = v & 1 ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1); crc32._t[i] = v; } }
      for (let i = 0; i < buf.length; i++) c = crc32._t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }
    const entries = files.map(f => {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      return { nameBytes, data, crc: crc32(data), size: data.length };
    });
    let pos = 0; const localOffsets = []; entries.forEach(e => { localOffsets.push(pos); pos += 30 + e.nameBytes.length + e.size; });
    const cdStart = pos; entries.forEach(e => { pos += 46 + e.nameBytes.length; });
    const out = new Uint8Array(pos + 22); const dv = new DataView(out.buffer);
    let p = 0;
    entries.forEach((e, i) => {
      out.set([0x50, 0x4B, 0x03, 0x04], p); writeUint16LE(dv, p + 4, 20); writeUint32LE(dv, p + 14, e.crc); writeUint32LE(dv, p + 18, e.size); writeUint32LE(dv, p + 22, e.size); writeUint16LE(dv, p + 26, e.nameBytes.length);
      out.set(e.nameBytes, p + 30); out.set(e.data, p + 30 + e.nameBytes.length); p += 30 + e.nameBytes.length + e.size;
    });
    entries.forEach((e, i) => {
      out.set([0x50, 0x4B, 0x01, 0x02], p); writeUint16LE(dv, p + 4, 20); writeUint16LE(dv, p + 6, 20); writeUint32LE(dv, p + 16, e.crc); writeUint32LE(dv, p + 20, e.size); writeUint32LE(dv, p + 24, e.size); writeUint16LE(dv, p + 28, e.nameBytes.length); writeUint32LE(dv, p + 42, localOffsets[i]);
      out.set(e.nameBytes, p + 46); p += 46 + e.nameBytes.length;
    });
    out.set([0x50, 0x4B, 0x05, 0x06], p); writeUint16LE(dv, p + 8, entries.length); writeUint16LE(dv, p + 10, entries.length); writeUint32LE(dv, p + 12, pos - cdStart); writeUint32LE(dv, p + 16, cdStart);
    return out;
  }

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/numbering.xml', data: numberingXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ]);
};

window.downloadResumeDocx = function(profile, resumeText, filename, templateId = 'standard') {
  const bytes = window.buildResumeDocx(profile, resumeText, templateId);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename || 'Resume') + '.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
