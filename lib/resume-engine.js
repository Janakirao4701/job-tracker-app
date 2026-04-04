/**
 * Shared Resume Generation Engine
 * Handles parsing tailored content and generating professional DOCX files.
 */
window.ResumeEngine = {
  parseContent: function(text) {
    const sections = { summary: '', skills: '', experience: '' };
    if (!text) return sections;

    // Define all possible section markers
    const markers = [
      { id: 'summary', regex: /(?:\[SUMMARY\]|SUMMARY:|PROFESSIONAL SUMMARY:|##\s*Summary)/i },
      { id: 'skills', regex: /(?:\[SKILLS\]|SKILLS:|TECHNICAL SKILLS:|##\s*Skills)/i },
      { id: 'experience', regex: /(?:\[EXPERIENCE\]|EXPERIENCE:|PROFESSIONAL EXPERIENCE:|WORK EXPERIENCE:|##\s*Experience)/i }
    ];

    // Find all occurrences of any marker
    let matches = [];
    markers.forEach(m => {
      let match;
      const re = new RegExp(m.regex, 'gi');
      while ((match = re.exec(text)) !== null) {
        matches.push({ id: m.id, index: match.index, length: match[0].length });
      }
    });

    // Sort matches by their position in the text
    matches.sort((a, b) => a.index - b.index);

    if (matches.length === 0) {
      // Heuristic Fallback: No markers found
      if (text.length < 1000) sections.summary = text.trim();
      else sections.experience = text.trim();
    } else {
      // Extract content between markers
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i].length;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
        const content = text.substring(start, end).trim();
        
        // Append to section (in case a section is repeated)
        if (sections[matches[i].id]) sections[matches[i].id] += '\n' + content;
        else sections[matches[i].id] = content;
      }
    }

    return sections;
  },

  parseSkills: function(text) {
    if (!text) return [];
    return text.split('\n').map(s => s.replace(/^[•\-\*]\s*/, '').trim()).filter(s => s.length > 0);
  },

  parseExperience: function(text) {
    if (!text) return [];
    const roles = [];
    const blocks = text.split(/(?=\n[•\-\*]\s*)/);
    let currentRole = null;
    blocks.forEach(block => {
      const trimmed = block.trim();
      if (!trimmed) return;
      if (!trimmed.startsWith('•') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
        if (currentRole) roles.push(currentRole);
        currentRole = { title: trimmed, bullets: [] };
      } else if (currentRole) {
        currentRole.bullets.push(trimmed.replace(/^[•\-\*]\s*/, '').trim());
      }
    });
    if (currentRole) roles.push(currentRole);
    return roles;
  },

  generate: async function(app, profile, options = {}) {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, BorderStyle, Table, TableRow, TableCell, WidthType, VerticalAlign } = window.docx;

    const FONT = "Calibri";
    const PRIMARY_COLOR = "000000";

    const { summary, skills, experience } = this.parseContent(app.resume);
    const skillList = this.parseSkills(skills);
    const expList = this.parseExperience(experience);

    const createHeader = () => {
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 65, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: profile.name || "YOUR NAME", bold: true, size: 44, font: FONT, color: PRIMARY_COLOR })],
                    spacing: { after: 40 }
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: profile.title || "Professional Title", bold: true, size: 24, font: FONT, color: "444444" })]
                  })
                ]
              }),
              new TableCell({
                width: { size: 35, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.BOTTOM,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: profile.location || "", size: 19, font: FONT })],
                    spacing: { after: 20 }
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: "📧 ", size: 18 }),
                      new TextRun({ text: profile.email || "", size: 19, font: FONT, color: "0000EE" })
                    ],
                    spacing: { after: 20 }
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: "📱 ", size: 18 }),
                      new TextRun({ text: profile.phone || "", size: 19, font: FONT })
                    ],
                    spacing: { after: 20 }
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: "🔗 ", size: 18 }),
                      new TextRun({ text: profile.linkedin || "", size: 19, font: FONT, color: "0000EE" })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      });
    };

    const createSectionHeading = (text) => {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        border: { bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 6 } },
        children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, font: FONT, color: PRIMARY_COLOR, characterSpacing: 20 })]
      });
    };

    const docChildren = [
      createHeader(),
      createSectionHeading("Professional Summary"),
      new Paragraph({
        alignment: AlignmentType.JUSTIFY,
        spacing: { line: 320, after: 120 },
        children: [new TextRun({ text: summary || "Professional summary content...", size: 20, font: FONT })]
      })
    ];

    if (skillList.length > 0) {
      docChildren.push(createSectionHeading("Technical Skills & Core Competencies"));
      docChildren.push(new Paragraph({
        spacing: { after: 120, line: 360 },
        children: [new TextRun({ text: skillList.join("  •  "), size: 20, font: FONT, bold: true })]
      }));
    }

    docChildren.push(createSectionHeading("Professional Experience"));
    expList.forEach(exp => {
      docChildren.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [new TextRun({ text: exp.title, bold: true, size: 20, font: FONT })]
      }));
      exp.bullets.forEach(bullet => {
        docChildren.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 40, after: 40, line: 300 },
          alignment: AlignmentType.JUSTIFY,
          children: [new TextRun({ text: bullet, size: 20, font: FONT })]
        }));
      });
    });

    if (profile.education) {
      docChildren.push(createSectionHeading("Education"));
      profile.education.split('\n').filter(Boolean).forEach(line => {
        docChildren.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: line, size: 20, font: FONT, bold: line.includes('|') })]
        }));
      });
    }

    if (profile.certs) {
      docChildren.push(createSectionHeading("Certifications"));
      profile.certs.split('\n').filter(Boolean).forEach(cert => {
        docChildren.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [new TextRun({ text: cert, size: 20, font: FONT })]
        }));
      });
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 792, bottom: 792, left: 936, right: 936 } }
        },
        children: docChildren
      }]
    });

    const blob = await Packer.toBlob(doc);
    const safeName = (app.company || "Resume").replace(/[^a-z0-9]/gi, '_');
    window.saveAs(blob, `${profile.name || "Resume"}_${safeName}.docx`);
  }
};
