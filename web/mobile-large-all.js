(() => {
  'use strict';
  const key = 'store-task-large-text-v1';
  const phone = matchMedia('(max-width: 700px)');
  if (!phone.matches) return;
  let large = false;
  try {
    const saved = localStorage.getItem(key);
    large = saved === '1' || (saved === null && localStorage.getItem('store-mobile-text-size') === 'double');
  } catch {}
  const standalone = !document.getElementById('workbench-task-readable') && !document.querySelector('link[href*="/task-readable.css"]');
  function apply() {
    document.documentElement.classList.toggle('task-text-large', large);
    document.body.classList.toggle('task-text-large', large);
    document.body.classList.add('mobile-type-active');
    document.body.classList.toggle('large-type-standalone', standalone);
    document.body.classList.toggle('family-page', location.pathname === '/family');
    document.body.classList.toggle('kitty-page', location.pathname === '/kitty');
    document.body.classList.toggle('receipt-page', ['/sale-receipt', '/payment-receipt'].includes(location.pathname));
    for (const button of document.querySelectorAll('.mobile-large-all-toggle')) {
      button.textContent = large ? '标准模式' : '大字版';
      button.setAttribute('aria-pressed', String(large));
      button.setAttribute('aria-label', large ? '当前大字版，切换标准模式' : '当前标准模式，切换大字版');
    }
  }
  function save(value) {
    large = value;
    try { localStorage.setItem(key, large ? '1' : '0'); } catch {}
    apply();
    dispatchEvent(new CustomEvent('store:font-change', { detail: { large } }));
  }
  function mount() {
    if (!document.querySelector('.text-size-toggle,[data-task-text-toggle],#text-size,#family-text,.mobile-large-all-toggle')) {
      const host = document.querySelector('body.home-workspace .top, body > header, main > header, .receipt-controls') || document.body;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-large-all-toggle';
      button.addEventListener('click', () => save(!large));
      host.append(button);
    }
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  addEventListener('storage', event => { if (event.key === key) { large = event.newValue === '1'; apply(); } });
  addEventListener('store:font-change', event => { if (typeof event.detail?.large === 'boolean') { large = event.detail.large; apply(); } });
})();
