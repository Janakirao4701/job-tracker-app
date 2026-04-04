const STORAGE_KEY = 'resume_builder_profile';

function loadAndInit() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(STORAGE_KEY, function(r) {
      initWithProfile(r[STORAGE_KEY] || {});
    });
  } else {
    var profile = {};
    try { profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) {}
    initWithProfile(profile);
  }
}

const inputs = {
  name: document.getElementById('in-name'),
  email: document.getElementById('in-email'),
  resume: document.getElementById('in-resume')
};

function initWithProfile(profile) {
  inputs.name.value = profile.name || '';
  inputs.email.value = profile.email || '';
  inputs.resume.value = profile.resume || '';

  Object.keys(inputs).forEach(function(k) { inputs[k].oninput = render; });
  render();
}

function render() {
  var name = inputs.name.value || 'Your Name';
  var email = inputs.email.value || 'Email';
  var txt = inputs.resume.value;

  var html = '<div class="header"><div class="name">' + name + '</div><div class="contact">' + email + '</div></div>';

  var sections = txt.split(/\[(.*?)\]/);
  for (var i = 1; i < sections.length; i += 2) {
    var h = sections[i].trim();
    var b = (sections[i+1] || '').trim();
    html += '<div class="section">' + h + '</div>';
    if (h.toLowerCase().includes('experience')) {
      b.split('\n').forEach(function(l) {
        var ps = l.split('|').map(function(x) { return x.trim(); });
        if (ps.length >= 2) html += '<div class="item-head"><span>' + ps[0] + '</span><span>' + ps[ps.length-1] + '</span></div>';
        else if (l.trim()) html += '<div>' + l + '</div>';
      });
    } else {
      html += '<div style="white-space:pre-wrap;">' + b + '</div>';
    }
  }
  document.getElementById('preview').innerHTML = html;
}

document.getElementById('dl-btn').onclick = function() {
  const profile = {
    name: inputs.name.value,
    email: inputs.email.value,
    resume: inputs.resume.value
  };
  const filename = (profile.name || 'Resume').replace(/\s+/g, '_') + '_Standard';
  if (typeof window.downloadResumeDocx === 'function') {
    window.downloadResumeDocx(profile, profile.resume, filename, 'standard');
  } else {
    alert('Builder library not loaded');
  }
};

loadAndInit();
