// Self-contained minimal DOCX Resume Builder — no external dependencies
// Same ZIP approach as xlsxbuilder.js — a .docx is just a ZIP of XML files
// Usage: const bytes = window.buildResumeDocx(profile, resumeText);

window.buildResumeDocx = function(profile, resumeText) {
  'use strict';

  const enc = new TextEncoder();

  function escXml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  // ── PARSE RESUME TEXT FOR [TAGS] ──
  function parseContent(raw) {
    if (!raw) return { summary:'', skills:'', experience:'' };
    const sTag = /\[(?:professional\s+)?summary\]/i;
    const kTag = /\[(?:technical\s+)?skills\]/i;
    const eTag = /\[(?:professional\s+)?experience\]/i;
    const summaryMatch = raw.match(new RegExp(sTag.source + '([\\s\\S]*?)(?=' + kTag.source + '|' + eTag.source + '|$)', 'i'));
    const skillsMatch  = raw.match(new RegExp(kTag.source + '([\\s\\S]*?)(?=' + sTag.source + '|' + eTag.source + '|$)', 'i'));
    const expMatch     = raw.match(new RegExp(eTag.source + '([\\s\\S]*?)(?=' + sTag.source + '|' + kTag.source + '|$)', 'i'));
    return {
      summary:    summaryMatch ? summaryMatch[1].trim() : '',
      skills:     skillsMatch  ? skillsMatch[1].trim()  : '',
      experience: expMatch     ? expMatch[1].trim()     : '',
    };
  }

  // ── OOXML HELPERS ──
  // Sizes: twips (1/20 pt). 1pt = 20twips. font size in half-points.
  const FONT = 'Arial';
  const BODY_SIZE = 21;  // 10.5pt in half-points
  const NAME_SIZE = 36;  // 18pt
  const TITLE_SIZE = 22; // 11pt
  const HEADING_SIZE = 22; // 11pt
  const BULLET_CHAR = '-';

  function makeParagraph(opts) {
    const { text, bold, italic, size, font, align, spacing, border, bullet, tab, children } = opts || {};
    let pPr = '';
    if (align) pPr += `<w:jc w:val="${align}"/>`;
    if (spacing) {
      const before = spacing.before || 0;
      const after = spacing.after || 0;
      pPr += `<w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>`;
    }
    if (border) {
      pPr += `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="000000"/></w:pBdr>`;
    }
    if (bullet) {
      pPr += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`;
    }
    if (tab) {
      pPr += `<w:tabs><w:tab w:val="right" w:pos="10800"/></w:tabs>`;
    }

    let runs = '';
    if (children && children.length) {
      runs = children.map(c => makeRun(c)).join('');
    } else if (text !== undefined) {
      runs = makeRun({ text, bold, italic, size: size || BODY_SIZE, font: font || FONT });
    }

    return `<w:p>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${runs}</w:p>`;
  }

  function makeRun(opts) {
    const { text, bold, italic, size, font, tab } = opts || {};
    if (tab) return `<w:r><w:tab/></w:r>`;
    let rPr = '';
    if (font)   rPr += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
    if (size)   rPr += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    if (bold)   rPr += `<w:b/><w:bCs/>`;
    if (italic) rPr += `<w:i/><w:iCs/>`;
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(text || '')}</w:t></w:r>`;
  }

  function makeHyperlink(text, url, rId, size) {
    const rPr = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
                `<w:sz w:val="${size || BODY_SIZE}"/><w:szCs w:val="${size || BODY_SIZE}"/>` +
                `<w:color w:val="0563C1"/><w:u w:val="single"/>`;
    return `<w:hyperlink r:id="${rId}"><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:hyperlink>`;
  }

  // ── BUILD SECTION HEADING ──
  function sectionHeading(text) {
    return makeParagraph({
      spacing: { before: 120, after: 40 },
      border: true,
      children: [{ text: text.toUpperCase(), bold: true, size: HEADING_SIZE, font: FONT }]
    });
  }

  // ── BUILD BULLET POINT ──
  function bulletPoint(text) {
    return makeParagraph({
      bullet: true,
      spacing: { before: 20, after: 20 },
      children: [{ text, size: BODY_SIZE, font: FONT }]
    });
  }

  // ── PARSE SKILLS ──
  function buildSkills(raw) {
    if (!raw) return makeParagraph({ text: '(skills not provided)', size: BODY_SIZE, font: FONT, spacing: { before: 30, after: 30 } });
    return raw.split('\n').filter(l => l.trim()).map(line => {
      const idx = line.indexOf(':');
      if (idx > -1) {
        return makeParagraph({
          spacing: { before: 30, after: 30 },
          children: [
            { text: line.substring(0, idx + 1), bold: true, size: BODY_SIZE, font: FONT },
            { text: line.substring(idx + 1), size: BODY_SIZE, font: FONT },
          ]
        });
      }
      return makeParagraph({ text: line, size: BODY_SIZE, font: FONT, spacing: { before: 30, after: 30 } });
    }).join('');
  }

  // ── PARSE EXPERIENCE ──
  function buildExperience(raw) {
    if (!raw) return makeParagraph({ text: '(experience not provided)', size: BODY_SIZE, font: FONT, spacing: { before: 30, after: 30 } });
    return raw.split('\n').filter(l => l.trim()).map(line => {
      const t = line.trim();
      if (t.startsWith('-') || t.startsWith('•') || t.startsWith('*')) {
        return bulletPoint(t.replace(/^[-•*]\s*/, ''));
      } else if (t.includes('|')) {
        const parts = t.split('|').map(p => p.trim());
        // Role | Company | Location | Dates
        let result = makeParagraph({
          spacing: { before: 120, after: 20 },
          tab: true,
          children: [
            { text: parts[0] || '', bold: true, size: HEADING_SIZE, font: FONT },
            { tab: true },
            { text: parts[3] || '', size: BODY_SIZE, font: FONT, italic: true },
          ]
        });
        result += makeParagraph({
          spacing: { before: 0, after: 40 },
          children: [{ text: (parts[1] || '') + (parts[2] ? ' | ' + parts[2] : ''), size: BODY_SIZE, font: FONT, italic: true }]
        });
        return result;
      }
      return makeParagraph({ text: t, size: BODY_SIZE, font: FONT, spacing: { before: 30, after: 30 } });
    }).join('');
  }

  // ── PARSE EDUCATION ──
  function buildEducation(raw) {
    if (!raw) return '';
    return raw.split('\n').map(l => l.trim()).filter(l => l).map(line => {
      const processed = line.replace(/\t/g, ' | ').replace(/\s{3,}/g, ' | ');
      const parts = processed.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 2) {
        let result = makeParagraph({
          spacing: { before: 100, after: 20 },
          tab: true,
          children: [
            { text: parts[0], bold: true, size: HEADING_SIZE, font: FONT },
            { tab: true },
            { text: parts[1], size: BODY_SIZE, font: FONT, italic: true }
          ]
        });
        if (parts[2]) {
          result += makeParagraph({
            spacing: { before: 0, after: 60 },
            children: [{ text: parts.slice(2).join(' | '), size: BODY_SIZE, font: FONT }]
          });
        }
        return result;
      }
      return makeParagraph({ text: line, size: BODY_SIZE, font: FONT, spacing: { before: 20, after: 20 } });
    }).join('');
  }

  // ── PARSE CERTIFICATIONS ──
  function buildCerts(raw) {
    if (!raw) return '';
    return raw.split('\n').map(l => l.trim()).filter(l => l && !/certifications/i.test(l)).map(line => {
      const clean = line.replace(/^[\s\-•\t\*·]+/, '').trim();
      return bulletPoint(clean);
    }).join('');
  }

  // ── COLLECT HYPERLINKS ──
  const hyperlinks = [];
  let hyperlinkId = 1;

  function addHyperlink(url) {
    const rId = 'rId' + hyperlinkId++;
    hyperlinks.push({ rId, url });
    return rId;
  }

  // ── BUILD DOCUMENT BODY ──
  const p = profile || {};
  const pName  = p.name     || 'User Name';
  const pTitle = p.title    || '';
  const pEmail = p.email    || '';
  const pPhone = p.phone    || '';
  const pLoc   = p.location || '';
  const pLink  = p.linkedin || '';
  const pEdu   = p.education || '';
  const pCerts = p.certs    || '';

  const { summary, skills, experience } = parseContent(resumeText);

  let body = '';

  // ── NAME ──
  body += makeParagraph({
    align: 'center',
    spacing: { before: 0, after: 40 },
    children: [{ text: pName, bold: true, size: NAME_SIZE, font: FONT }]
  });

  // ── PROFESSIONAL TITLE ──
  if (pTitle) {
    body += makeParagraph({
      align: 'center',
      spacing: { before: 0, after: 60 },
      children: [{ text: pTitle, size: TITLE_SIZE, font: FONT }]
    });
  }

  // ── CONTACT LINE ──
  const contactParts = [pEmail, pPhone, pLoc].filter(x => x);
  if (contactParts.length) {
    const contactRuns = [];
    contactParts.forEach((part, idx) => {
      if (part === pEmail) {
        const rId = addHyperlink('mailto:' + part);
        // For contact line, we inline the hyperlink XML directly
        contactRuns.push({ text: part, size: BODY_SIZE, font: FONT });
      } else {
        contactRuns.push({ text: part, size: BODY_SIZE, font: FONT });
      }
      if (idx < contactParts.length - 1) {
        contactRuns.push({ text: '  |  ', size: BODY_SIZE, font: FONT });
      }
    });
    body += makeParagraph({ align: 'center', spacing: { before: 0, after: 20 }, children: contactRuns });
  }

  // ── LINKEDIN ──
  if (pLink) {
    const rId = addHyperlink(pLink.startsWith('http') ? pLink : 'https://' + pLink);
    body += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>${makeHyperlink(pLink, pLink, rId, BODY_SIZE)}</w:p>`;
  }

  // ── SUMMARY ──
  body += sectionHeading('PROFESSIONAL SUMMARY');
  body += makeParagraph({
    spacing: { before: 60, after: 40 },
    children: [{ text: summary || '(not provided)', size: BODY_SIZE, font: FONT }]
  });

  // ── SKILLS ──
  body += sectionHeading('TECHNICAL SKILLS');
  body += buildSkills(skills);

  // ── EXPERIENCE ──
  body += sectionHeading('WORK EXPERIENCE');
  body += buildExperience(experience);

  // ── EDUCATION ──
  if (pEdu) {
    body += sectionHeading('EDUCATION');
    body += buildEducation(pEdu);
  }

  // ── CERTIFICATIONS ──
  if (pCerts) {
    body += sectionHeading('CERTIFICATIONS');
    body += buildCerts(pCerts);
  }

  // ── NUMBERING (for bullets) ──
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="${BULLET_CHAR}"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="480" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  // ── DOCUMENT XML ──
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ── STYLES XML ──
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>
        <w:sz w:val="${BODY_SIZE}"/>
        <w:szCs w:val="${BODY_SIZE}"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
</w:styles>`;

  // ── RELATIONSHIPS ──
  let docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;
  hyperlinks.forEach(h => {
    docRels += `\n  <Relationship Id="${h.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(h.url)}" TargetMode="External"/>`;
  });
  docRels += `\n</Relationships>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  // ── ZIP BUILDER (same as xlsxbuilder.js) ──
  function buildZip(files) {
    function writeUint16LE(dv, offset, val) { dv.setUint16(offset, val, true); }
    function writeUint32LE(dv, offset, val) { dv.setUint32(offset, val, true); }
    function crc32(buf) {
      let c = 0xFFFFFFFF;
      if (!crc32._t) {
        crc32._t = new Uint32Array(256);
        for (let i=0;i<256;i++) { let v=i; for(let j=0;j<8;j++) v=v&1?(0xEDB88320^(v>>>1)):(v>>>1); crc32._t[i]=v; }
      }
      for (let i=0;i<buf.length;i++) c=crc32._t[(c^buf[i])&0xFF]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    }
    const entries = files.map(f => {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      return { nameBytes, data, crc: crc32(data), size: data.length };
    });
    let totalLocal = 0;
    entries.forEach(e => { totalLocal += 30 + e.nameBytes.length + e.size; });
    let totalCentral = 0;
    entries.forEach(e => { totalCentral += 46 + e.nameBytes.length; });
    const totalSize = totalLocal + totalCentral + 22;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);
    let pos = 0;
    const localOffsets = [];
    entries.forEach(e => {
      localOffsets.push(pos);
      out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x03; out[pos+3]=0x04;
      writeUint16LE(dv, pos+4, 20);
      writeUint16LE(dv, pos+6, 0);
      writeUint16LE(dv, pos+8, 0);
      writeUint16LE(dv, pos+10, 0);
      writeUint16LE(dv, pos+12, 0);
      writeUint32LE(dv, pos+14, e.crc);
      writeUint32LE(dv, pos+18, e.size);
      writeUint32LE(dv, pos+22, e.size);
      writeUint16LE(dv, pos+26, e.nameBytes.length);
      writeUint16LE(dv, pos+28, 0);
      out.set(e.nameBytes, pos+30);
      out.set(e.data, pos+30+e.nameBytes.length);
      pos += 30 + e.nameBytes.length + e.size;
    });
    const cdStart = pos;
    entries.forEach((e, i) => {
      const loff = localOffsets[i];
      out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x01; out[pos+3]=0x02;
      writeUint16LE(dv, pos+4, 20);
      writeUint16LE(dv, pos+6, 20);
      writeUint16LE(dv, pos+8, 0);
      writeUint16LE(dv, pos+10, 0);
      writeUint16LE(dv, pos+12, 0);
      writeUint16LE(dv, pos+14, 0);
      writeUint32LE(dv, pos+16, e.crc);
      writeUint32LE(dv, pos+20, e.size);
      writeUint32LE(dv, pos+24, e.size);
      writeUint16LE(dv, pos+28, e.nameBytes.length);
      writeUint16LE(dv, pos+30, 0);
      writeUint16LE(dv, pos+32, 0);
      writeUint16LE(dv, pos+34, 0);
      writeUint16LE(dv, pos+36, 0);
      writeUint32LE(dv, pos+38, 0);
      writeUint32LE(dv, pos+42, loff);
      out.set(e.nameBytes, pos+46);
      pos += 46 + e.nameBytes.length;
    });
    const cdSize = pos - cdStart;
    out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x05; out[pos+3]=0x06;
    writeUint16LE(dv, pos+4, 0);
    writeUint16LE(dv, pos+6, 0);
    writeUint16LE(dv, pos+8, entries.length);
    writeUint16LE(dv, pos+10, entries.length);
    writeUint32LE(dv, pos+12, cdSize);
    writeUint32LE(dv, pos+16, cdStart);
    writeUint16LE(dv, pos+20, 0);
    return out;
  }

  // ── ASSEMBLE ZIP ──
  const files = [
    { name: '[Content_Types].xml',               data: contentTypes },
    { name: '_rels/.rels',                        data: relsXml },
    { name: 'word/document.xml',                  data: documentXml },
    { name: 'word/styles.xml',                    data: stylesXml },
    { name: 'word/numbering.xml',                 data: numberingXml },
    { name: 'word/_rels/document.xml.rels',       data: docRels },
  ];

  return buildZip(files);
};

// Helper: download resume as .docx file
window.downloadResumeDocx = function(profile, resumeText, filename) {
  const bytes = window.buildResumeDocx(profile, resumeText);
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
