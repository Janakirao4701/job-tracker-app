/**
 * AI Blaze — Copilot v2.0 (Modular Engine)
 * 
 * Features:
 * 1. Highlight-to-Prompt (Quick Actions)
 * 2. Shortcut Triggers Anywhere (-ans, /fix)
 * 3. Shadow DOM UI Injection
 * 
 * Powered by Gemini 2.5 & Ollama
 */

(function() {
  'use strict';

  // Check if v2 is enabled (Async for chrome.storage.local)
  async function init() {
    const isV2Enabled = await new Promise(res => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['rjd_v2_enabled'], (data) => res(data.rjd_v2_enabled === true));
      } else {
        res(localStorage.getItem('rjd_v2_enabled') === 'true');
      }
    });

    if (!isV2Enabled) {
      console.log('AI Blaze Copilot v2.0: Beta Disabled — Toggle in Settings to enable.');
      return;
    }

    console.log('AI Blaze Copilot v2.0: Active 🚀');
    initShadowUI();
    attachListeners();
  }

  // ── Elements & State ──
  let floatingToolbar = null;
  let shadowRoot = null;

  /**
   * Initialize Shadow DOM for UI isolation
   */
  function initShadowUI() {
    const container = document.createElement('div');
    container.id = 'rjd-copilot-host';
    document.body.appendChild(container);
    shadowRoot = container.attachShadow({ mode: 'open' });

    // Inject styles into Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      :host { font-family: 'Outfit', 'Inter', -apple-system, sans-serif; --accent: #4f46e5; --accent-glow: rgba(79, 70, 229, 0.4); }
      .toolbar {
        position: fixed; z-index: 2147483647; background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        display: flex; align-items: center; gap: 4px; padding: 6px;
        opacity: 0; transform: translateY(10px) scale(0.95);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: none;
      }
      .toolbar.visible {
        opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;
      }
      .btn {
        padding: 8px 12px; border-radius: 10px; border: none; background: transparent;
        color: #1e293b; font-size: 13px; font-weight: 600; cursor: pointer;
        display: flex; align-items: center; gap: 6px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
      }
      .btn:hover { background: var(--accent); color: white; transform: translateY(-1px); box-shadow: 0 4px 12px var(--accent-glow); }
      .btn:active { transform: translateY(0); }
      .btn svg { width: 14px; height: 14px; }
      .divider { width: 1px; height: 20px; background: rgba(0,0,0,0.08); margin: 0 6px; }
      
      /* Modal Styles */
      .modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647; opacity: 0; pointer-events: none; transition: opacity 0.3s;
      }
      .modal-overlay.visible { opacity: 1; pointer-events: auto; }
      .modal {
        background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 20px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.2); width: 360px; padding: 24px;
        transform: scale(0.9) translateY(20px); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .modal-overlay.visible .modal { transform: scale(1) translateY(0); }
      .modal-title { font-size: 18px; font-weight: 800; color: #1e293b; margin-bottom: 8px; }
      .modal-sub { font-size: 13px; color: #64748b; margin-bottom: 20px; }
      .form-field { margin-bottom: 16px; }
      .form-field label { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; }
      .form-input { 
        width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid #e2e8f0;
        font-family: inherit; font-size: 14px; transition: border-color 0.2s;
      }
      .form-input:focus { border-color: var(--accent); outline: none; }
      
      /* Dark mode */
      @media (prefers-color-scheme: dark) {
        .toolbar { background: rgba(15, 23, 42, 0.8); border-color: rgba(255,255,255,0.1); }
        .btn { color: #f1f5f9; }
        .divider { background: rgba(255,255,255,0.1); }
        .modal { background: rgba(30, 41, 59, 0.9); border-color: rgba(255, 255, 255, 0.05); }
        .modal-title { color: #f8fafc; }
        .form-input { background: #0f172a; border-color: #334155; color: white; }
      }
    `;
    shadowRoot.appendChild(style);
  }

  /**
   * Show floating toolbar at selection
   */
  function handleSelection() {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text || text.length < 2) {
      hideToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    showToolbar(rect.left + (rect.width / 2), rect.top - 50, text);
  }

  function showToolbar(x, y, text) {
    if (!floatingToolbar) {
      floatingToolbar = document.createElement('div');
      floatingToolbar.className = 'toolbar';
      shadowRoot.appendChild(floatingToolbar);
    }

    floatingToolbar.innerHTML = `
      <button class="btn" id="rjd-fix-grammar">✨ Fix Grammar</button>
      <button class="btn" id="rjd-summarize">📝 Summarize</button>
      <button class="btn" id="rjd-reply">💬 Reply</button>
      <div class="divider"></div>
      <button class="btn" id="rjd-ask-ai" style="color:var(--accent);">✦ Ask AI</button>
    `;

    // Positioning
    floatingToolbar.style.left = `${Math.max(10, Math.min(window.innerWidth - 300, x - 150))}px`;
    floatingToolbar.style.top = `${Math.max(10, y)}px`;
    floatingToolbar.classList.add('visible');

    // Attach Toolbar Listeners
    floatingToolbar.querySelectorAll('.btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        handleAction(btn.id.replace('rjd-', ''), text);
      };
    });
  }

  function hideToolbar() {
    if (floatingToolbar) floatingToolbar.classList.remove('visible');
  }

  /**
   * Execute AI action
   */
  async function handleAction(action, text) {
    hideToolbar();
    
    // Check if it's a fixed prompt or custom-loaded
    let template = "";
    const fixedPrompts = {
      'fix-grammar': `Fix grammar, spelling, and professional tone in this text: "${text}"`,
      'summarize': `Summarize the main points of this text concisely: "${text}"`,
      'reply': `Draft a polite and professional reply to this: "${text}"`,
      'ask-ai': `Process this text and provide helpful insights: "${text}"`
    };

    if (fixedPrompts[action]) {
      template = fixedPrompts[action];
    } else {
      // Load from shortcuts
      const templates = await new Promise(res => {
        chrome.storage.local.get(['rjd_blaze_shortcuts'], d => {
          res(d.rjd_blaze_shortcuts || JSON.parse(localStorage.getItem('rjd_blaze_shortcuts') || '[]'));
        });
      });
      const t = templates.find(item => item.key === action);
      template = t ? t.prompt : action;
    }

    const { type, prompt, tags } = await parsePrompt(template);

    if (type === 'form') {
      showFormModal(prompt, tags);
    } else {
      // Toggle sidebar and send prompt
      window.postMessage({ type: 'AI_BLAZE_OPEN_SIDEBAR', prompt }, '*');
    }
  }

  function showFormModal(basePrompt, tags) {
    let overlay = shadowRoot.querySelector('.modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      shadowRoot.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">Complete Request</div>
        <div class="modal-sub">Personalize your AI prompt by filling the fields below.</div>
        <div id="form-fields">
          ${tags.map((tag, i) => `
            <div class="form-field">
              <label>${tag.label}</label>
              ${tag.type === 'formmenu' ? `
                <select class="form-input" data-raw="${tag.raw}">
                  ${tag.label.split('|').slice(1).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                </select>
              ` : `
                <input type="${tag.type==='formdate'?'date':'text'}" class="form-input" data-raw="${tag.raw}" placeholder="..." />
              `}
            </div>
          `).join('')}
        </div>
        <div style="display:flex; gap:12px; margin-top:10px;">
          <button class="btn" id="modal-cancel" style="flex:1; justify-content:center; border:1px solid #e2e8f0;">Cancel</button>
          <button class="btn btn-primary" id="modal-submit" style="flex:2; justify-content:center;">Execute AI Blast 🚀</button>
        </div>
      </div>
    `;

    overlay.classList.add('visible');

    overlay.querySelector('#modal-cancel').onclick = () => overlay.classList.remove('visible');
    overlay.querySelector('#modal-submit').onclick = () => {
      let finalPrompt = basePrompt;
      overlay.querySelectorAll('.form-input').forEach(input => {
        finalPrompt = finalPrompt.replace(input.dataset.raw, input.value);
      });
      overlay.classList.remove('visible');
      window.postMessage({ type: 'AI_BLAZE_OPEN_SIDEBAR', prompt: finalPrompt }, '*');
    };
  }

  /**
   * ── Shortcut Triggers ──
   */
  function attachListeners() {
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('mousedown', (e) => {
      if (shadowRoot.contains(e.target)) return;
      hideToolbar();
    });

    // Handle Input Triggers
    document.addEventListener('keyup', (e) => {
      const el = e.target;
      if (!['INPUT', 'TEXTAREA'].includes(el.tagName) && !el.isContentEditable) return;
      
      if (e.key === ' ' || e.key === 'Enter') {
        checkShortcuts(el);
      }
    });

    // Handle AI Response & Inline Actions
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'AI_BLAZE_RESPONSE_READY') {
        if (window.__rjd_active_el) {
          replaceText(window.__rjd_active_el, '✦ AI generating... ', event.data.text);
          window.__rjd_active_el = null;
        } else {
          // Show Inline Modal with actions
          showInlineResultModal(event.data.text);
        }
      }
    });
  }

  function showInlineResultModal(text) {
    let overlay = shadowRoot.querySelector('.modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      shadowRoot.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal" style="width:500px;">
        <div class="modal-title">AI Response</div>
        <div style="background:var(--bg-inset,#f1f5f9); padding:16px; border-radius:12px; font-size:14px; max-height:300px; overflow-y:auto; line-height:1.6; color:#1e293b; margin-bottom:20px;">
          ${text.replace(/\n/g, '<br>')}
        </div>
        <div style="display:flex; gap:12px;">
          <button class="btn" id="res-copy" style="flex:1; justify-content:center; border:1px solid #e2e8f0;">📋 Copy</button>
          <button class="btn btn-primary" id="res-done" style="flex:1; justify-content:center;">Done ✓</button>
        </div>
      </div>
    `;

    overlay.classList.add('visible');

    overlay.querySelector('#res-copy').onclick = () => {
      navigator.clipboard.writeText(text);
      overlay.querySelector('#res-copy').textContent = '✓ Copied';
      setTimeout(() => overlay.querySelector('#res-copy').textContent = '📋 Copy', 2000);
    };
    overlay.querySelector('#res-done').onclick = () => overlay.classList.remove('visible');
  }

  async function checkShortcuts(el) {
    const val = el.value || el.innerText || '';
    const triggers = ['-ans', '-cover', '-sum', '/fix', '/rewrite'];
    
    for (const t of triggers) {
      if (val.endsWith(t + ' ')) {
        const triggerPos = val.lastIndexOf(t);
        const precedingText = val.substring(0, triggerPos).trim();
        
        console.log(`AI Blaze Copilot: Trigger "${t}" detected. Context: "${precedingText}"`);
        
        // Show loading state in the field
        replaceText(el, t + ' ', '✦ AI generating... ');

        // Perform AI request
        handleShortcutAction(t, precedingText, el);
      }
    }
  }

  async function handleShortcutAction(trigger, context, el) {
    let prompt = '';
    if (trigger === '-ans') prompt = `Based on my resume, answer this application question: "${context || 'No specific question provided'}"`;
    else if (trigger === '-cover') prompt = `Generate a short cover letter snippet for ${context || 'this role'}.`;
    else if (trigger === '/fix') prompt = `Fix grammar and professionalize this text: "${context}"`;
    else if (trigger === '/rewrite') prompt = `Rewrite this text to be more impactful: "${context}"`;
    else prompt = `Process this: "${context}"`;

    // Send to Sidebar (UI interaction)
    window.postMessage({
      type: 'AI_BLAZE_QUICK_ACTION',
      action: 'shortcut',
      text: context,
      prompt: prompt,
      targetEl: true // Signal for replacement
    }, '*');
    
    // Store current el to replace later when response comes
    window.__rjd_active_el = el;
  }

  function replaceText(el, oldText, newText) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = el.value.replace(oldText, newText);
    } else {
      el.innerText = el.innerText.replace(oldText, newText);
    }
  }

  /**
   * ── Prompt Parser & Scrapers ──
   */
  const Scrapers = {
    linkedin: () => {
      const jobEl = document.querySelector('.job-view-layout') || document.body;
      return {
        company: jobEl.querySelector('.job-details-jobs-unified-top-card__company-name a')?.innerText 
              || jobEl.querySelector('.job-details-jobs-unified-top-card__company-name')?.innerText 
              || document.querySelector('.topcard__org-name-link')?.innerText
              || '',
        title:   jobEl.querySelector('.job-details-jobs-unified-top-card__job-title h1')?.innerText
              || document.querySelector('.top-card-layout__title')?.innerText
              || '',
        description: jobEl.querySelector('#job-details')?.innerText || ''
      };
    },
    greenhouse: () => {
      return {
        company: document.querySelector('.company-name')?.innerText || '',
        title: document.querySelector('.app-title')?.innerText || '',
        description: document.querySelector('#content')?.innerText || ''
      };
    },
    lever: () => {
      return {
        company: document.querySelector('meta[property="og:site_name"]')?.content || document.title.split('-')?.[1]?.trim() || '',
        title: document.querySelector('.posting-headline h2')?.innerText || '',
        description: document.querySelector('.posting-sections')?.innerText || ''
      };
    },
    workday: () => {
      const logo = document.querySelector('[data-automation-id="companyLogo"]');
      return {
        company: logo?.alt || logo?.getAttribute('aria-label') || document.title.split('-')?.[0]?.trim() || '',
        title: document.querySelector('[data-automation-id="jobTitle"]')?.innerText || '',
        description: document.querySelector('[data-automation-id="jobPostingDescription"]')?.innerText || ''
      };
    },
    generic: () => {
      const url = new URL(window.location.href);
      const host = url.hostname.toLowerCase().replace(/^www\.|^jobs\.|^careers\.|^boards\.|^app\./, '');
      const parts = host.split('.');
      let hostname = parts[0];

      // Sync with content.js: Handle subdomains and path-based identifiers
      if (parts.length >= 3 && (host.includes('lever.co') || host.includes('greenhouse.io') || host.includes('workdayjobs.com'))) {
        hostname = parts[0];
      } else if (host === 'lever.co' || host === 'greenhouse.io') {
         const pathParts = url.pathname.split('/').filter(Boolean);
         if (pathParts.length > 0) hostname = pathParts[0];
      }

      const fallbackCompany = hostname.replace(/[\-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return {
        company: fallbackCompany,
        title: document.title.split('|')[0].split('-')[0].trim(),
        url: window.location.href,
        description: document.body.innerText.substring(0, 3000)
      };
    }
  };

  async function parsePrompt(template) {
    let prompt = template;
    const site = window.location.hostname.includes('linkedin') ? 'linkedin' : 
                 window.location.hostname.includes('greenhouse') ? 'greenhouse' : 'generic';
    const context = Scrapers[site]();

    // Replace basic tags
    prompt = prompt.replace(/{company}/g, context.company || '');
    prompt = prompt.replace(/{title}/g, context.title || '');
    prompt = prompt.replace(/{selection}/g, context.selection || window.getSelection().toString());
    prompt = prompt.replace(/{url}/g, window.location.href);
    prompt = prompt.replace(/{page_context}/g, context.description || document.body.innerText.substring(0, 2000));

    // Check for Form Tags
    if (prompt.includes('{form')) {
      return { type: 'form', prompt, tags: extractFormTags(prompt) };
    }

    return { type: 'text', prompt };
  }

  function extractFormTags(prompt) {
    const tags = [];
    const regex = /{(formtext|formmenu|formdate):([^}]+)}/g;
    let match;
    while ((match = regex.exec(prompt)) !== null) {
      tags.push({ type: match[1], label: match[2], raw: match[0] });
    }
    return tags;
  }

  // ── Start Engine ──
  init();

})();
