// Defensive global error handling for ad-blockers and missing libraries
window.addEventListener('error', function(e) {
  if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
    const url = e.target.src || e.target.href;
    if (url && (url.includes('airgap') || url.includes('datadog') || url.includes('sentry'))) {
      console.warn('[AI Blaze] Telemetry blocked by client (ad-blocker):', url);
      e.preventDefault(); 
      return true;
    }
  }
}, true);
