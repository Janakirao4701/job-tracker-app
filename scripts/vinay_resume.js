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

// ── DOWNLOAD ──
document.getElementById('btn-dl-word').onclick = function() {
  const filename = (currentProfile.name || 'Resume').replace(/\s+/g, '_') + '_Vinay';
  if (typeof window.downloadResumeDocx === 'function') {
    window.downloadResumeDocx(currentProfile, currentProfile.resume, filename, 'p2p_vinay');
  } else {
    alert('Builder library not loaded');
  }
};

// Initialize
loadAndInit();
