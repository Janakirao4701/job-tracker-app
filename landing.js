// Smooth scroll for data-scroll elements
document.querySelectorAll('[data-scroll]').forEach(el => {
  el.addEventListener('click', () => {
    const target = document.getElementById(el.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// Navigate for data-href elements
document.querySelectorAll('[data-href]').forEach(el => {
  el.addEventListener('click', () => {
    window.location.href = el.dataset.href;
  });
});

// Settings nav interaction
document.querySelectorAll('.settings-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});
