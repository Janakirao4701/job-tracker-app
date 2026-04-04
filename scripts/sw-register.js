if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=3')
      .then(reg => {
        console.log('Service Worker registered:', reg.scope);
      })
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}
