(() => {
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.navlinks');
  if (!header || !nav) return;

  if (!nav.id) nav.id = 'site-navigation';

  let toggle = header.querySelector('.nav-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', nav.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = '<span class="nav-toggle-icon" aria-hidden="true"></span>';
    nav.parentNode.insertBefore(toggle, nav);
  }

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    document.body.classList.toggle('nav-menu-open', open);
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (!header.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  const desktopQuery = window.matchMedia('(min-width: 821px)');
  const handleDesktop = (event) => {
    if (event.matches) setOpen(false);
  };
  if (desktopQuery.addEventListener) desktopQuery.addEventListener('change', handleDesktop);
})();
