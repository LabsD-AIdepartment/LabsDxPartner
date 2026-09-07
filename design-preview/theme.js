/* Day remains the default; remember an explicit choice on this device. */
(() => {
  const root = document.documentElement;
  let theme = 'light';
  try { if (localStorage.getItem('labsd-theme') === 'dark') theme = 'dark'; } catch {}
  root.dataset.theme = theme;
  const apply = () => {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#030806' : '#ececea';
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const label = theme === 'dark' ? 'เปลี่ยนเป็นโหมด Day' : 'เปลี่ยนเป็นโหมด Dark';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.title = label;
  };
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      apply();
      try { localStorage.setItem('labsd-theme', theme); } catch {}
    });
  });
})();
