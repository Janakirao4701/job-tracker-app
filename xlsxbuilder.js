// Self-contained minimal XLSX builder — no external dependencies
window.buildXLSX = async function(sheetsData) {

  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const enc = new TextEncoder();

  // ── SHARED STRINGS ──
  const strings = [];
  const stringMap = {};
  function si(str) {
    str = String(str == null ? '' : str);
    if (stringMap[str] === undefined) { stringMap[str] = strings.length; strings.push(str); }
    return stringMap[str];
  }

  function escXml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  // ── CELL REFERENCE ──
  function colLetter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }
  function cellRef(r, c) { return colLetter(c) + r; }

  // ── STYLES ──
  function stylesXml() {
    const fonts = [
      `<font><sz val="10"/><name val="Arial"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FFFFFFFF"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF1F4E79"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF276749"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF9C5700"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FFFFFFFF"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF9C0006"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF808080"/></font>`,
      `<font><sz val="9"/><name val="Arial"/></font>`,
      `<font><sz val="10"/><name val="Arial"/><color rgb="FF2E75B6"/><u/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/></font>`,
      `<font><sz val="14"/><b/><name val="Arial"/><color rgb="FF1F4E79"/></font>`,
      `<font><sz val="9"/><i/><name val="Arial"/><color rgb="FF555555"/></font>`,
      `<font><sz val="9"/><b/><name val="Arial"/><color rgb="FFFFFFFF"/></font>`,
      `<font><sz val="20"/><b/><name val="Arial"/><color rgb="FF1F4E79"/></font>`,
      `<font><sz val="10"/><b/><name val="Arial"/><color rgb="FF276749"/></font>`,
      `<font><sz val="10"/><name val="Arial"/><color rgb="FF808080"/></font>`,
    ];
    const fills = [
      `<fill><patternFill patternType="none"/></fill>`,
      `<fill><patternFill patternType="gray125"/></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFDDEEFF"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFFFFDE7"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF00B050"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFEBF4FF"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF2E75B6"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF70AD47"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF00B050"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFED7D31"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF5B9BD5"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FFEBF4FF"/></patternFill></fill>`,
    ];
    const borders = [
      `<border><left/><right/><top/><bottom/><diagonal/></border>`,
      `<border><left style="thin"><color rgb="FFBDD7EE"/></left><right style="thin"><color rgb="FFBDD7EE"/></right><top style="thin"><color rgb="FFBDD7EE"/></top><bottom style="thin"><color rgb="FFBDD7EE"/></bottom><diagonal/></border>`,
    ];

    const mkxf = (fi, fili, bi, ha='left', va='top', wrap=false) =>
      `<xf numFmtId="0" fontId="${fi}" fillId="${fili}" borderId="${bi}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${ha}" vertical="${va}" wrapText="${wrap?1:0}"/></xf>`;

    const xfs = [
      mkxf(0,0,0),                         // 0 default
      mkxf(1,2,1,'center','middle'),        // 1 header
      mkxf(2,3,1,'center','middle'),        // 2 applied
      mkxf(3,4,1,'center','middle'),        // 3 interview scheduled
      mkxf(4,5,1,'center','middle'),        // 4 interview done
      mkxf(5,6,1,'center','middle'),        // 5 offer
      mkxf(6,7,1,'center','middle'),        // 6 rejected
      mkxf(7,8,1,'center','middle'),        // 7 skipped
      mkxf(0,9,1),                          // 8 alt row
      mkxf(8,0,1,'left','top',true),        // 9 wrap normal
      mkxf(8,9,1,'left','top',true),        // 10 wrap alt
      mkxf(9,0,1,'left','top'),             // 11 link
      mkxf(10,0,1),                         // 12 bold
      mkxf(0,0,1,'center','middle'),        // 13 center
      mkxf(0,9,1,'center','middle'),        // 14 center alt
      mkxf(11,0,0,'left','middle'),         // 15 title
      mkxf(12,0,0,'left','middle'),         // 16 subtitle
      mkxf(13,10,1,'center','middle'),      // 17 kpi label 1
      mkxf(14,16,1,'center','middle'),      // 18 kpi value
      mkxf(1,2,1,'center','middle'),        // 19 section header
      mkxf(15,0,1,'left','middle'),         // 20 green bold
      mkxf(16,0,1,'left','middle'),         // 21 gray text
      mkxf(13,11,1,'center','middle'),      // 22 kpi label 2
      mkxf(13,12,1,'center','middle'),      // 23 kpi label 3
      mkxf(13,13,1,'center','middle'),      // 24 kpi label 4
      mkxf(13,14,1,'center','middle'),      // 25 kpi label 5
      mkxf(13,15,1,'center','middle'),      // 26 kpi label 6
    ];

    return `${xmlDecl}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`;
  }

  // ── SHEET XML ──
  function buildSheetXml(sheetDef) {
    const { rows, colWidths, merges, rowHeights } = sheetDef;
    const links = [];
    let linkId = 1;

    let xml = `${xmlDecl}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
    xml += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
    xml += `<cols>`;
    colWidths.forEach((w,i) => { xml += `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`; });
    xml += `</cols><sheetData>`;

    rows.forEach((row, ri) => {
      const rn = ri + 1;
      const ht = rowHeights && rowHeights[ri] ? ` ht="${rowHeights[ri]}" customHeight="1"` : '';
      xml += `<row r="${rn}"${ht}>`;
      row.forEach((cell, ci) => {
        if (cell == null) return;
        const ref = cellRef(rn, ci + 1);
        const s = cell.s || 0;
        if (cell.t === 'n') {
          xml += `<c r="${ref}" s="${s}" t="n"><v>${Number(cell.v)}</v></c>`;
        } else {
          const idx = si(String(cell.v == null ? '' : cell.v));
          xml += `<c r="${ref}" s="${s}" t="s"><v>${idx}</v></c>`;
        }
        if (cell.url) links.push({ ref, url: cell.url, rId: `rId${linkId++}` });
      });
      xml += `</row>`;
    });

    xml += `</sheetData>`;
    if (merges && merges.length) {
      xml += `<mergeCells count="${merges.length}">`;
      merges.forEach(m => { xml += `<mergeCell ref="${m}"/>`; });
      xml += `</mergeCells>`;
    }
    if (links.length) {
      xml += `<hyperlinks>`;
      links.forEach(l => { xml += `<hyperlink ref="${l.ref}" r:id="${l.rId}"/>`; });
      xml += `</hyperlinks>`;
    }
    xml += `</worksheet>`;
    return { xml, links };
  }

  function sharedStringsXml() {
    return `${xmlDecl}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s=>`<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('')}</sst>`;
  }

  function workbookXml(names) {
    return `${xmlDecl}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${escXml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  }

  function workbookRels(sheetCount) {
    let r = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
    for (let i=0;i<sheetCount;i++) r+=`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`;
    r+=`<Relationship Id="rId${sheetCount+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
    r+=`<Relationship Id="rId${sheetCount+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    return r + `</Relationships>`;
  }

  function sheetRels(links) {
    if (!links || !links.length) return null;
    let r = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
    links.forEach(l => { r += `<Relationship Id="${l.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(l.url)}" TargetMode="External"/>`; });
    return r + `</Relationships>`;
  }

  function contentTypesXml(sheetCount) {
    let x = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`;
    for (let i=0;i<sheetCount;i++) x+=`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    return x+`<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  }

  // ── PROPER ZIP BUILDER ──
  function buildZip(files) {
    // Use DataView for precise byte-level control
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

    // Calculate total size
    let totalLocal = 0;
    entries.forEach(e => { totalLocal += 30 + e.nameBytes.length + e.size; });
    let totalCentral = 0;
    entries.forEach(e => { totalCentral += 46 + e.nameBytes.length; });
    const totalSize = totalLocal + totalCentral + 22;

    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);
    let pos = 0;
    const localOffsets = [];

    // Write local file headers + data
    entries.forEach(e => {
      localOffsets.push(pos);
      // Local file header signature
      out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x03; out[pos+3]=0x04;
      writeUint16LE(dv, pos+4, 20);           // version needed
      writeUint16LE(dv, pos+6, 0);            // flags
      writeUint16LE(dv, pos+8, 0);            // compression: stored
      writeUint16LE(dv, pos+10, 0);           // mod time
      writeUint16LE(dv, pos+12, 0);           // mod date
      writeUint32LE(dv, pos+14, e.crc);       // crc32
      writeUint32LE(dv, pos+18, e.size);      // compressed size
      writeUint32LE(dv, pos+22, e.size);      // uncompressed size
      writeUint16LE(dv, pos+26, e.nameBytes.length); // filename length
      writeUint16LE(dv, pos+28, 0);           // extra field length
      out.set(e.nameBytes, pos+30);
      out.set(e.data, pos+30+e.nameBytes.length);
      pos += 30 + e.nameBytes.length + e.size;
    });

    const cdStart = pos;

    // Write central directory headers
    entries.forEach((e, i) => {
      const loff = localOffsets[i];
      out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x01; out[pos+3]=0x02;
      writeUint16LE(dv, pos+4, 20);           // version made by
      writeUint16LE(dv, pos+6, 20);           // version needed
      writeUint16LE(dv, pos+8, 0);            // flags
      writeUint16LE(dv, pos+10, 0);           // compression
      writeUint16LE(dv, pos+12, 0);           // mod time
      writeUint16LE(dv, pos+14, 0);           // mod date
      writeUint32LE(dv, pos+16, e.crc);       // crc32
      writeUint32LE(dv, pos+20, e.size);      // compressed size
      writeUint32LE(dv, pos+24, e.size);      // uncompressed size
      writeUint16LE(dv, pos+28, e.nameBytes.length); // filename length
      writeUint16LE(dv, pos+30, 0);           // extra field length
      writeUint16LE(dv, pos+32, 0);           // file comment length
      writeUint16LE(dv, pos+34, 0);           // disk number start
      writeUint16LE(dv, pos+36, 0);           // internal attributes
      writeUint32LE(dv, pos+38, 0);           // external attributes
      writeUint32LE(dv, pos+42, loff);        // local header offset
      out.set(e.nameBytes, pos+46);
      pos += 46 + e.nameBytes.length;
    });

    const cdSize = pos - cdStart;

    // End of central directory record
    out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x05; out[pos+3]=0x06;
    writeUint16LE(dv, pos+4, 0);              // disk number
    writeUint16LE(dv, pos+6, 0);              // start disk
    writeUint16LE(dv, pos+8, entries.length); // entries on disk
    writeUint16LE(dv, pos+10, entries.length);// total entries
    writeUint32LE(dv, pos+12, cdSize);        // cd size
    writeUint32LE(dv, pos+16, cdStart);       // cd offset
    writeUint16LE(dv, pos+20, 0);             // comment length

    return out;
  }

  // ── BUILD ALL SHEETS ──
  const processedSheets = sheetsData.map(s => buildSheetXml(s));
  const ssXml = sharedStringsXml(); // call after all si() calls

  const files = [
    { name: '[Content_Types].xml',          data: contentTypesXml(sheetsData.length) },
    { name: '_rels/.rels',                  data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml',              data: workbookXml(sheetsData.map(s=>s.name)) },
    { name: 'xl/_rels/workbook.xml.rels',   data: workbookRels(sheetsData.length) },
    { name: 'xl/styles.xml',                data: stylesXml() },
    { name: 'xl/sharedStrings.xml',         data: ssXml },
  ];

  processedSheets.forEach((ps, i) => {
    files.push({ name: `xl/worksheets/sheet${i+1}.xml`, data: ps.xml });
    const rels = sheetRels(ps.links);
    if (rels) files.push({ name: `xl/worksheets/_rels/sheet${i+1}.xml.rels`, data: rels });
  });

  return buildZip(files);
};
