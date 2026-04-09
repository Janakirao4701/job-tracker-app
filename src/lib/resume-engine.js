/**
 * Shared Resume Generation Engine (Premium v2.0)
 * Integrated from standalone Premium Resume Maker logic.
 * Handles high-fidelity parsing and LaTeX-style DOCX generation.
 */
window.ResumeEngine = {
  // ── CONTENT PARSING (Robust split-based) ──
  parseContent: function (text) {
    const sections = { summary: '', skills: '', experience: '' };
    if (!text) return sections;

    const markers = [
      { id: 'summary', regex: /(?:\[\s*(?:PROFESSIONAL\s+)?SUMMARY\s*\]|SUMMARY:|PROFESSIONAL SUMMARY:|##\s*Summary)/i },
      { id: 'skills', regex: /(?:\[\s*(?:TECHNICAL\s+)?SKILLS\s*\]|SKILLS:|TECHNICAL SKILLS:|##\s*Skills)/i },
      { id: 'experience', regex: /(?:\[\s*(?:PROFESSIONAL\s+)?EXPERIENCE\s*\]|EXPERIENCE:|PROFESSIONAL EXPERIENCE:|WORK EXPERIENCE:|##\s*Experience)/i }
    ];

    let matches = [];
    markers.forEach(m => {
      let match;
      const re = new RegExp(m.regex, 'gi');
      while ((match = re.exec(text)) !== null) {
        matches.push({ id: m.id, index: match.index, length: match[0].length });
      }
    });

    matches.sort((a, b) => a.index - b.index);

    if (matches.length === 0) {
      // SMART HEURISTIC: No markers found
      const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
      if (blocks.length > 0) {
        sections.summary = blocks[0].trim();
        if (blocks.length > 1) {
          // If first block was short, treat as summary, rest as experience
          sections.experience = blocks.slice(1).join('\n\n').trim();
        }
      }
    } else {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i].length;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
        const content = text.substring(start, end).trim();
        if (sections[matches[i].id]) sections[matches[i].id] += '\n' + content;
        else sections[matches[i].id] = content;
      }
    }
    return sections;
  },

  // ── PREMIUM HELPERS ──

  // DASH BULLET (LaTeX style)
  makeBullet: function (text, docx, FONT, SZ_BODY, COLOR_DARK) {
    const { Paragraph, TextRun } = docx;
    return new Paragraph({
      indent: { left: 180, hanging: 180 }, // Tighter following user feedback
      spacing: { before: 15, after: 15 },
      children: [
        new TextRun({ text: '•  ', bold: true, font: FONT, size: SZ_BODY, color: COLOR_DARK }),
        new TextRun({ text, font: FONT, size: SZ_BODY, color: COLOR_DARK })
      ]
    });
  },

  // SECTION HEADING (With bottom rule)
  sectionHeading: function (text, docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE) {
    const { Paragraph, TextRun, BorderStyle } = docx;
    return new Paragraph({
      spacing: { before: 180, after: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_RULE, space: 4 } },
      children: [new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: SZ_SEC,
        font: FONT,
        color: COLOR_HEAD
      })]
    });
  },

  parseSkills: function (raw, docx, FONT, SZ_BODY, COLOR_HEAD, COLOR_DARK) {
    const { Paragraph, TextRun } = docx;
    if (!raw) return [];
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.match(/^\[/));
    return lines.map(line => {
      const idx = line.indexOf(':');
      // Case 1: Standard Category: Item1, Item2
      if (idx > -1 && idx < 60) {
        return new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [
            new TextRun({ text: line.substring(0, idx + 1), bold: true, font: FONT, size: SZ_BODY, color: COLOR_HEAD }),
            new TextRun({ text: ' ' + line.substring(idx + 1).trimStart(), font: FONT, size: SZ_BODY, color: COLOR_DARK }),
          ]
        });
      }
      // Case 2: Category Header on its own line (Short line, no commas)
      const isHeader = line.length < 50 && !line.includes(',');
      if (isHeader) {
        return new Paragraph({
          spacing: { before: 40, after: 10 },
          children: [new TextRun({ text: line, bold: true, font: FONT, size: SZ_BODY, color: COLOR_HEAD })]
        });
      }
      // Case 3: Plain skills list or unknown format
      return new Paragraph({ 
        spacing: { before: 10, after: 30 }, 
        children: [new TextRun({ text: line, font: FONT, size: SZ_BODY, color: COLOR_DARK })] 
      });
    });
  },

  parseExperience: function (raw, docx, FONT, SZ_JOB, SZ_BODY, SZ_BASE, TEXT_W, COLOR_HEAD, COLOR_DARK, COLOR_MID, COLOR_LIGHT) {
    const { Paragraph, TextRun, TabStopType } = docx;
    if (!raw) return [];
    
    // Split by newline but handle cases where content might be pasted with mixed separators
    const lines = raw.split('\n').filter(l => l.trim());
    const result = [];
    
    for (const line of lines) {
      let t = line.trim();
      if (!t || t.match(/^\[/)) continue;

      // Handle Key Achievements / Highlights Header (Bold)
      if (t.toLowerCase().includes('key achievements:') || t.toLowerCase().includes('highlights:') || t.toLowerCase().includes('responsibilities:')) {
        const colonIdx = t.indexOf(':');
        const headerText = colonIdx > -1 ? t.substring(0, colonIdx + 1) : t;
        const restText = colonIdx > -1 ? t.substring(colonIdx + 1).trim() : '';

        result.push(new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({ text: headerText, bold: true, font: FONT, size: SZ_BODY, color: COLOR_DARK }),
            ...(restText ? [new TextRun({ text: ' ' + restText, font: FONT, size: SZ_BODY, color: COLOR_DARK })] : [])
          ]
        }));
        continue;
      }

      if (t.startsWith('-') || t.startsWith('•') || t.startsWith('*') || t.startsWith('·')) {
        result.push(this.makeBullet(t.replace(/^[-•*·]\s*/, ''), docx, FONT, SZ_BODY, COLOR_DARK));
      } else if (t.includes('|')) {
        const parts = t.split('|').map(p => p.trim());
        let company = '', location = '', jobTitle = '', dateRange = '';

        if (parts.length >= 4) {
          company = parts[0]; location = parts[1]; jobTitle = parts[2]; dateRange = parts[3];
        } else if (parts.length === 3) {
          company = parts[0]; jobTitle = parts[1]; dateRange = parts[2];
        } else if (parts.length === 2) {
          company = parts[0]; dateRange = parts[1];
        }

        if (company || dateRange) {
          result.push(new Paragraph({
            spacing: { before: 180, after: 30 },
            tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
            children: [
              new TextRun({ text: company.toUpperCase(), bold: true, font: FONT, size: SZ_BODY, color: COLOR_HEAD }),
              new TextRun({ text: '\t' }),
              new TextRun({ text: dateRange, font: FONT, size: SZ_BASE, italics: true, color: COLOR_MID }),
            ]
          }));
        }

        const titleText = `${jobTitle}${location ? ', ' + location : ''}`;
        if (titleText) {
          result.push(new Paragraph({
            spacing: { before: 0, after: 50 },
            children: [new TextRun({ text: titleText, bold: true, font: FONT, size: SZ_JOB, color: COLOR_DARK })]
          }));
        }
      } else {
        // Fallback: If line is short and ends with colon, bold it (automatic category detection)
        if (t.length < 50 && t.endsWith(':')) {
             result.push(new Paragraph({
               spacing: { before: 80, after: 40 },
               children: [new TextRun({ text: t, bold: true, font: FONT, size: SZ_BODY, color: COLOR_DARK })]
             }));
        } else {
             result.push(new Paragraph({ spacing: { before: 30, after: 30 }, children: [new TextRun({ text: t, font: FONT, size: SZ_BODY, color: COLOR_DARK })] }));
        }
      }
    }
    return result;
  },

  parseEducation: function (raw, docx, FONT, SZ_JOB, SZ_BODY, SZ_BASE, TEXT_W, COLOR_HEAD, COLOR_MID, COLOR_LIGHT, COLOR_DARK) {
    const { Paragraph, TextRun, TabStopType } = docx;
    if (!raw) return [];
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    const result = [];
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 2) {
        const degree = parts[0] || '';
        const dateRange = parts[1] || '';
        const institution = parts[2] || '';
        const country = parts[3] || '';

        // Row 1: DEGREE (Left) | DATE (Right)
        result.push(new Paragraph({
          spacing: { before: 160, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
          children: [
            new TextRun({ text: degree, bold: true, font: FONT, size: SZ_JOB, color: COLOR_HEAD }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: dateRange, font: FONT, size: SZ_BASE, italics: true, color: COLOR_MID }),
          ]
        }));

        // Row 2: INSTITUTION, COUNTRY
        if (institution) {
          const instChildren = [new TextRun({ text: institution, font: FONT, size: SZ_BODY, color: COLOR_MID })];
          if (country) {
            instChildren.push(new TextRun({ text: ', ' + country, font: FONT, size: SZ_BODY, color: COLOR_MID }));
          }
          result.push(new Paragraph({ spacing: { before: 0, after: 40 }, children: instChildren }));
        }
      } else {
        result.push(new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: line, font: FONT, size: SZ_BODY, color: COLOR_DARK })] }));
      }
    }
    return result;
  },

  parseCerts: function (raw, docx, FONT, SZ_BODY, COLOR_DARK) {
    if (!raw) return [];
    return raw.split('\n').map(l => l.trim()).filter(l => l && !l.match(/^certif/i))
      .map(line => this.makeBullet(line.replace(/^[\s\-•*·]+/, '').trim(), docx, FONT, SZ_BODY, COLOR_DARK));
  },

  // ── MAIN GENERATOR ──
  generate: async function (app, profile, options = {}) {
    const docx = window.docx;
    const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType, TabStopType, LevelFormat } = docx;

    // ── PREMIUM CONSTANTS ──
    const PAGE_W = 12240; const PAGE_H = 15840;
    const MAR_TB = 792; const MAR_LR = 936;
    const TEXT_W = PAGE_W - MAR_LR * 2;
    const SZ_BASE = 20; const SZ_NAME = 34; const SZ_TITLE = 22;
    const SZ_SEC = 22; const SZ_JOB = 21; const SZ_BODY = 20;
    const FONT = 'Calibri';
    const COLOR_HEAD = '000000'; const COLOR_DARK = '222222';
    const COLOR_MID = '555555'; const COLOR_LIGHT = '888888'; const COLOR_RULE = 'AAAAAA';

    // Parse Content
    const { summary, skills, experience } = this.parseContent(app.resume);

    // Build Header Rows
    const docChildren = [
      // Name & Phone Row
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 40 },
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
        children: [
          new TextRun({ text: profile.name || 'Your Name', bold: true, font: FONT, size: SZ_NAME, color: COLOR_HEAD }),
          new TextRun({ text: '\t' }),
          ...(profile.phone ? [new TextRun({ text: 'Mobile: ' + profile.phone, font: FONT, size: SZ_BODY, color: COLOR_DARK })] : [])
        ]
      }),
      // Title & Email Row
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
        children: [
          ...(profile.title ? [new TextRun({ text: profile.title, font: FONT, size: SZ_TITLE, italics: true, color: COLOR_MID })] : []),
          new TextRun({ text: '\t' }),
          ...(profile.email ? [new ExternalHyperlink({
            children: [new TextRun({ text: profile.email, font: FONT, size: SZ_BODY, color: COLOR_DARK })],
            link: `mailto:${profile.email}`
          })] : [])
        ]
      }),
      // Location & LinkedIn Row
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 80 },
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
        children: [
          ...(profile.location ? [new TextRun({ text: profile.location, font: FONT, size: SZ_BODY, italics: true, color: COLOR_DARK })] : []),
          new TextRun({ text: '\t' }),
          ...(profile.linkedin ? [new ExternalHyperlink({
            children: [new TextRun({ text: profile.linkedin.replace(/^https?:\/\//, ''), font: FONT, size: SZ_BODY, color: COLOR_DARK })],
            link: profile.linkedin.startsWith('http') ? profile.linkedin : `https://${profile.linkedin}`
          })] : [])
        ]
      }),

      // SUMMARY
      this.sectionHeading('Professional Summary', docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE),
      new Paragraph({
        spacing: { before: 20, after: 40 },
        children: [new TextRun({ text: summary || '(not provided)', font: FONT, size: SZ_BODY, color: COLOR_DARK })]
      }),

      // SKILLS
      this.sectionHeading('Technical Skills', docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE),
      ...this.parseSkills(skills, docx, FONT, SZ_BODY, COLOR_HEAD, COLOR_DARK),

      // EXPERIENCE
      this.sectionHeading('Professional Experience', docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE),
      ...this.parseExperience(experience, docx, FONT, SZ_JOB, SZ_BODY, SZ_BASE, TEXT_W, COLOR_HEAD, COLOR_DARK, COLOR_MID, COLOR_LIGHT)
    ];

    // Optional Sections
    if (profile.education) {
      docChildren.push(this.sectionHeading('Education', docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE));
      docChildren.push(...this.parseEducation(profile.education, docx, FONT, SZ_JOB, SZ_BODY, SZ_BASE, TEXT_W, COLOR_HEAD, COLOR_MID, COLOR_LIGHT, COLOR_DARK));
    }
    if (profile.certs) {
      docChildren.push(this.sectionHeading('Certifications', docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE));
      docChildren.push(...this.parseCerts(profile.certs, docx, FONT, SZ_BODY, COLOR_DARK));
    }

    // Custom Sections (Projects, etc.)
    if (Array.isArray(profile.custom_sections)) {
      for (const sec of profile.custom_sections) {
        if (!sec.title || !sec.content) continue;
        docChildren.push(this.sectionHeading(sec.title, docx, FONT, SZ_SEC, COLOR_HEAD, COLOR_RULE));
        const lines = sec.content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const t = line.trim();
          if (t.startsWith('-') || t.startsWith('•') || t.startsWith('*') || t.startsWith('·')) {
            docChildren.push(this.makeBullet(t.replace(/^[-•*·]\s*/, ''), docx, FONT, SZ_BODY, COLOR_DARK));
          } else if (t.length < 50 && t.endsWith(':')) {
            docChildren.push(new Paragraph({ 
              spacing: { before: 80, after: 40 }, 
              children: [new TextRun({ text: t, bold: true, font: FONT, size: SZ_BODY, color: COLOR_DARK })] 
            }));
          } else {
            docChildren.push(new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: t, font: FONT, size: SZ_BODY, color: COLOR_DARK })] }));
          }
        }
      }
    }

    // Build Final Document
    const finalDoc = new Document({
      numbering: {
        config: [{
          reference: 'bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '-',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 864, hanging: 360 } } }
          }]
        }]
      },
      styles: {
        default: { document: { run: { font: FONT, size: SZ_BASE, color: COLOR_DARK } } }
      },
      sections: [{
        properties: {
          page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MAR_TB, right: MAR_LR, bottom: MAR_TB, left: MAR_LR } }
        },
        children: docChildren.filter(x => x)
      }]
    });

    const blob = await Packer.toBlob(finalDoc);
    const safeName = (profile.name || "Resume").replace(/[^a-z0-9]/gi, '_');
    window.saveAs(blob, `${safeName}_Resume.docx`);
  },

  // ── JD GENERATOR (Plain Text Export) ──
  generateJD: async function (app) {
    const docx = window.docx;
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;

    const FONT = 'Calibri';
    const SZ_NAME = 30; // Slightly smaller than resume name
    const SZ_TITLE = 22;
    const SZ_BODY = 20;
    const COLOR_HEAD = '000000';
    const COLOR_DARK = '222222';

    const docChildren = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: app.company || 'Job Application', bold: true, font: FONT, size: SZ_NAME, color: COLOR_HEAD })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 400 },
        children: [new TextRun({ text: app.jobTitle || 'Job Description', bold: true, italics: true, font: FONT, size: SZ_TITLE, color: COLOR_DARK })]
      })
    ];

    // Handle JD text with basic paragraph/bullet splitting
    const jdText = app.jd || 'No job description provided.';
    const lines = jdText.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('-') || t.startsWith('•') || t.startsWith('*') || t.startsWith('·')) {
        docChildren.push(this.makeBullet(t.replace(/^[-•*·]\s*/, ''), docx, FONT, SZ_BODY, COLOR_DARK));
      } else {
        docChildren.push(new Paragraph({ 
          spacing: { before: 120, after: 120 }, 
          children: [new TextRun({ text: t, font: FONT, size: SZ_BODY, color: COLOR_DARK })] 
        }));
      }
    }

    const finalDoc = new Document({
      styles: { default: { document: { run: { font: FONT, size: SZ_BODY, color: COLOR_DARK } } } },
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: docChildren
      }]
    });

    const blob = await Packer.toBlob(finalDoc);
    const safeName = (app.company || "Job").replace(/[^a-z0-9]/gi, '_');
    window.saveAs(blob, `${safeName}_JD.docx`);
  }
};
