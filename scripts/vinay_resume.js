// ── DATA SYNC & RENDERING ──
const inputs = {
  name: document.getElementById('in-name'),
  title: document.getElementById('in-title'),
  loc: document.getElementById('in-loc'),
  phone: document.getElementById('in-phone'),
  email: document.getElementById('in-email'),
  link: document.getElementById('in-link'),
  resume: document.getElementById('in-resume')
};

const views = {
  name: document.getElementById('view-name'),
  title: document.getElementById('view-title'),
  loc: document.getElementById('view-loc'),
  phone: document.getElementById('view-phone'),
  email: document.getElementById('view-email'),
  link: document.getElementById('view-link'),
  content: document.getElementById('view-content')
};

// Load from chrome.storage.local first, then localStorage fallback
const STORAGE_KEY = 'resume_builder_profile';

function loadAndInit() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(STORAGE_KEY, (r) => {
      let profile = r[STORAGE_KEY] || {};
      if (!profile.name) {
        profile = getDefaults();
      }
      initWithProfile(profile);
    });
  } else {
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) {}
    if (!profile.name) profile = getDefaults();
    initWithProfile(profile);
  }
}

function getDefaults() {
  return {
    name: "Venkata Vinay Vamsi Yeddula",
    title: "Senior Data Analyst",
    location: "United States",
    phone: "Mobile: +1 (414) 895-2296",
    email: "yvvinayvamsi1207@gmail.com",
    linkedin: "linkedin.com/in/venkata-vinay-v-yeddula",
    resume: `[Professional Summary]
Senior Data Analyst with 5+ years of experience in healthcare analytics and technical reporting, delivering insights across large-scale datasets supporting clinical and operational decision-making. Analyzed, developed, and delivered solutions using SQL, Python, Tableau, and Power BI.

[Technical Skills]
Databases and Warehousing: SQL, T-SQL, Snowflake, AWS Redshift, Azure Synapse, Windows Functions
Programming and ML: Python, Pandas, NumPy, SciPy, Scikit-learn, TensorFlow, R, Predictive Analytics
BI and Reporting: Tableau, Power BI, Data Visualization, KPI Dashboards, Executive Reporting
Cloud Platforms: AWS, Azure, GCP

[Professional Experience]
Senior Data Analyst | Prudential Financial | New Jersey, USA | December 2023 - Present
- Analyzed healthcare and operational datasets using SQL and Python to support clinical and business decision-making.
- Developed automated reporting workflows using SQL stored procedures and Python, saving 10+ hours per week.
- Developed Power BI and Tableau dashboards to deliver insights on performance metrics.
- Partnered with stakeholders to gather requirements and translate business needs into data-driven solutions.

Data Analyst | Verizon | India | March 2020 - July 2023
- Developed churn prediction models improving accuracy by 18% using Python, enabling retention strategies.
- Reduced issue resolution time by 25% by developing Tableau and Power BI dashboards.
- Built ETL pipelines using Informatica and Azure Data Factory to integrate multi-source data.

[Education]
Master of Science in Computer Science | Concordia University Wisconsin | USA | 2023 - 2025
Bachelor of Technology in Computer Science | Sree Vidyanikethan | India | 2015 - 2019

[Certifications]
- AWS Certified Developer — Associate (in progress)`
  };
}

let currentProfile = {};

function initWithProfile(profile) {
  currentProfile = profile;

  // Populate inputs with mapped keys
  inputs.name.value = profile.name || '';
  inputs.title.value = profile.title || '';
  inputs.loc.value = profile.location || '';
  inputs.phone.value = profile.phone || '';
  inputs.email.value = profile.email || '';
  inputs.link.value = profile.linkedin || '';
  inputs.resume.value = profile.resume || '';

  Object.keys(inputs).forEach(k => inputs[k].addEventListener('input', render));
  render();
}

function render() {
  currentProfile.name = inputs.name.value;
  currentProfile.title = inputs.title.value;
  currentProfile.location = inputs.loc.value;
  currentProfile.phone = inputs.phone.value;
  currentProfile.email = inputs.email.value;
  currentProfile.linkedin = inputs.link.value;
  currentProfile.resume = inputs.resume.value;

  // Save to both storages
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentProfile));
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: currentProfile });
  }

  views.name.textContent = currentProfile.name || 'User Name';
  views.title.textContent = currentProfile.title || '';
  views.loc.textContent = currentProfile.location || '';
  views.phone.textContent = currentProfile.phone || '';
  views.email.textContent = currentProfile.email || '';
  views.link.textContent = currentProfile.linkedin || '';

  // Advanced Parser
  const raw = currentProfile.resume || '';
  let html = '';

  const sections = raw.split(/\[(.*?)\]/);
  for (let i = 1; i < sections.length; i += 2) {
    const header = sections[i].trim();
    const body = (sections[i+1] || '').trim();

    html += `<div class="r-section"><div class="r-sec-title">${header}</div>`;

    if (header.toLowerCase().includes('experience')) {
      const lines = body.split('\n').map(l => l.trim()).filter(l => l);
      let inUl = false;
      lines.forEach(line => {
        const parts = line.split('|').map(x => x.trim()).filter(x => x);
        const textOnly = line.replace(/^[\-•\s\*]+/, '').trim();
        if (parts.length >= 2) {
          if (inUl) { html += '</ul>'; inUl = false; }
          html += `<div class="r-job"><div class="r-job-head"><span>${parts[0].toUpperCase()}</span><span class="r-job-date">${parts[parts.length-1]}</span></div>`;
          const middle = parts.slice(1, -1);
          if (middle.length > 0) html += `<div class="r-job-sub">${middle.join(' | ')}</div>`;
          html += '</div>';
        } else if (textOnly.toLowerCase().startsWith('key achievements')) {
          if (inUl) { html += '</ul>'; inUl = false; }
          html += `<div class="r-key-ach">${textOnly}</div>`;
        } else if (textOnly) {
          if (!inUl) { html += '<ul class="r-ul">'; inUl = true; }
          html += `<li class="r-li">${textOnly}</li>`;
        }
      });
      if (inUl) html += '</ul>';
    } else if (header.toLowerCase().includes('education')) {
      body.split('\n').filter(l => l.trim()).forEach(line => {
        const parts = line.split('|').map(x => x.trim()).filter(x => x);
        if (parts.length >= 2) {
          html += `<div class="r-edu"><div class="r-edu-head"><span>${parts[0]}</span><span class="r-job-date">${parts[parts.length-1]}</span></div>`;
          const middle = parts.slice(1, -1);
          if (middle.length > 0) html += `<div class="r-edu-sub">${middle.join(' <span class="r-sep">|</span> ')}</div>`;
          html += `</div>`;
        }
      });
    } else {
      if (body.includes('\n- ') || body.startsWith('- ')) {
        html += '<ul class="r-ul">';
        body.split('\n').forEach(li => { if(li.trim()) html += `<li class="r-li">${li.replace(/^[\-•\s\*]+/, '')}</li>`; });
        html += '</ul>';
      } else {
        html += `<p class="r-summary">${body.replace(/\n/g, '<br>')}</p>`;
      }
    }
    html += `</div>`;
  }
  views.content.innerHTML = html;
}

// ── SPECIALIZED DOCX BUILDER ──
document.getElementById('btn-dl-word').onclick = function() {
  const bytes = buildDocx(currentProfile);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentProfile.name || 'Resume').replace(/\s+/g, '_') + '.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

function buildDocx(p) {
  const enc = new TextEncoder();
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

  const FONT = 'Times New Roman';
  const SIZE_BODY = 20;
  const SIZE_NAME = 36;
  const SIZE_HEAD = 20;

  function makeP(runs, opts) {
    opts = opts || {};
    const { align, border, before, after, bullet, tabRight } = opts;
    let pPr = '';
    if (align) pPr += '<w:jc w:val="' + align + '"/>';
    const b = before || 0;
    const a2 = (bullet && after === undefined) ? 30 : (after || 0);
    pPr += '<w:spacing w:before="' + b + '" w:after="' + a2 + '" w:line="240" w:lineRule="auto"/>';
    if (border) pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="AAAAAA"/></w:pBdr>';
    if (bullet) pPr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    if (tabRight) pPr += '<w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs>';

    return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + runs.map(function(r) {
      if (r === 'tab') return '<w:r><w:tab/></w:r>';
      return '<w:r><w:rPr><w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '" w:cs="' + FONT + '"/>' + (r.bold ? '<w:b/><w:bCs/>' : '') + (r.italic ? '<w:i/><w:iCs/>' : '') + '<w:sz w:val="' + (r.size || SIZE_BODY) + '"/><w:szCs w:val="' + (r.size || SIZE_BODY) + '"/><w:color w:val="' + (r.color || '000000') + '"/></w:rPr><w:t xml:space="preserve">' + esc(r.text) + '</w:t></w:r>';
    }).join('') + '</w:p>';
  }

  let doc = '';
  doc += makeP([{ text: p.name, bold: true, size: SIZE_NAME }, 'tab', { text: p.phone, color: '111111' }], { tabRight: true });
  doc += makeP([{ text: p.title, italic: true, color: '555555' }, 'tab', { text: p.email, color: '2B2B2B' }], { tabRight: true });
  doc += makeP([{ text: p.location || '', italic: true, color: '888888' }, 'tab', { text: p.linkedin || '', color: '2B2B2B' }], { tabRight: true, after: 120 });

  const raw = p.resume || '';
  const sections = raw.split(/\[(.*?)\]/);
  for (let i = 1; i < sections.length; i += 2) {
    const header = sections[i].trim();
    const body = (sections[i+1] || '').trim();
    doc += makeP([{ text: header.toUpperCase(), bold: true, size: SIZE_HEAD }], { border: true, before: 180, after: 80 });

    if (header.toLowerCase().includes('experience')) {
      body.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l; }).forEach(function(line) {
        var ps = line.split('|').map(function(x){ return x.trim(); }).filter(function(x){ return x; });
        var textOnly = line.replace(/^[\-•\s\*]+/, '').trim();
        if (ps.length >= 2) {
          doc += makeP([{ text: ps[0].toUpperCase(), bold: true, size: 17 }, 'tab', { text: ps[ps.length-1], italic: true, color: '555555', size: 17 }], { tabRight: true, before: 100 });
          var mid = ps.slice(1, -1);
          if (mid.length > 0) doc += makeP([{ text: mid.join(' | '), bold: true, color: '2B2B2B', size: 17 }], { after: 40 });
        } else if (textOnly.toLowerCase().startsWith('key achievements')) {
          doc += makeP([{ text: textOnly, bold: true, size: 17 }], { before: 80, after: 20 });
        } else if (textOnly) {
          doc += makeP([{ text: textOnly }], { bullet: true });
        }
      });
    } else if (header.toLowerCase().includes('skills')) {
      body.split('\n').forEach(function(l) {
        var idx = l.indexOf(':');
        if (idx > -1) doc += makeP([{ text: l.substring(0, idx + 1), bold: true }, { text: l.substring(idx+1) }], { after: 20 });
        else if (l.trim()) doc += makeP([{ text: l }], { after: 20 });
      });
    } else if (header.toLowerCase().includes('education')) {
      body.split('\n').forEach(function(l) {
        var ps = l.split('|').map(function(x){ return x.trim(); });
        if (ps.length >= 2) {
          doc += makeP([{ text: ps[0], bold: true, size: 17 }, 'tab', { text: ps[ps.length-1], italic: true, color: '555555', size: 18 }], { tabRight: true, before: 80 });
          var mid = ps.slice(1, -1);
          if (mid.length > 0) doc += makeP([{ text: mid.join(' | '), color: '555555', size: 17 }], { after: 40 });
        }
      });
    } else {
      body.split('\n').forEach(function(l) {
        if (l.trim().startsWith('-')) doc += makeP([{ text: l.replace(/^\-/, '') }], { bullet: true });
        else doc += makeP([{ text: l }], { after: 40 });
      });
    }
  }

  var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + doc + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="792" w:right="936" w:bottom="792" w:left="936" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var numberingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="480" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>';

  function buildZip(files) {
    function write16(dv, o, v) { dv.setUint16(o, v, true); }
    function write32(dv, o, v) { dv.setUint32(o, v, true); }
    function crc32(b2) {
      var c = 0xFFFFFFFF;
      if (!crc32._t) { crc32._t = new Uint32Array(256); for (var i2=0;i2<256;i2++) { var v=i2; for(var j=0;j<8;j++) v=v&1?(0xEDB88320^(v>>>1)):(v>>>1); crc32._t[i2]=v; } }
      for (var i2=0;i2<b2.length;i2++) c=crc32._t[(c^b2[i2])&0xFF]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    }
    var es = files.map(function(f) { var nb = enc.encode(f.name); var d = typeof f.data==='string'?enc.encode(f.data):f.data; return { nb:nb, d:d, crc: crc32(d), sz: d.length }; });
    var tl=0; es.forEach(function(e) { tl += 30 + e.nb.length + e.sz; });
    var tc=0; es.forEach(function(e) { tc += 46 + e.nb.length; });
    var out = new Uint8Array(tl + tc + 22); var dv = new DataView(out.buffer);
    var pos = 0; var offs = [];
    es.forEach(function(e) {
      offs.push(pos); out.set([0x50,0x4B,0x03,0x04], pos);
      write16(dv, pos+4, 20); write32(dv, pos+14, e.crc); write32(dv, pos+18, e.sz); write32(dv, pos+22, e.sz); write16(dv, pos+26, e.nb.length);
      out.set(e.nb, pos+30); out.set(e.d, pos+30+e.nb.length); pos += 30 + e.nb.length + e.sz;
    });
    var cds = pos;
    es.forEach(function(e, idx) {
      out.set([0x50,0x4B,0x01,0x02], pos); write16(dv, pos+4, 20); write16(dv, pos+6, 20); write32(dv, pos+16, e.crc); write32(dv, pos+20, e.sz); write32(dv, pos+24, e.sz); write16(dv, pos+28, e.nb.length); write32(dv, pos+42, offs[idx]);
      out.set(e.nb, pos+46); pos += 46 + e.nb.length;
    });
    out.set([0x50,0x4B,0x05,0x06], pos); write16(dv, pos+8, es.length); write16(dv, pos+10, es.length); write32(dv, pos+12, pos-cds); write32(dv, pos+16, cds);
    return out;
  }

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/numbering.xml', data: numberingXml },
    { name: 'word/_rels/document.xml.rels', data: docRels }
  ]);
}

// Initialize
loadAndInit();
