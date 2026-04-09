// Defensive global error handling for ad-blockers and missing libraries
window.addEventListener('error', function(e) {
  if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
    const url = e.target.src || e.target.href;
    if (url && (url.includes('airgap') || url.includes('datadog') || url.includes('sentry') || url.includes('ingest.sentry.io'))) {
      console.warn('[AI Blaze] Resource blocked by client (expected):', url);
      e.preventDefault(); 
      return true;
    }
  }
}, true);
