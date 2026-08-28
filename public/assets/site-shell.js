(() => {
  const nav = document.querySelector('.navlinks');
  if (!nav) return;

  const instagramHref = '/instagram-downloader/';
  let instagramLink = nav.querySelector(`a[href="${instagramHref}"]`);

  if (!instagramLink) {
    instagramLink = document.createElement('a');
    instagramLink.href = instagramHref;
    instagramLink.textContent = 'Instagram Downloader';

    const guidesLink = nav.querySelector('a[href="/guides/"]');
    if (guidesLink) nav.insertBefore(instagramLink, guidesLink);
    else {
      const cta = nav.querySelector('.nav-cta');
      if (cta) nav.insertBefore(instagramLink, cta);
      else nav.appendChild(instagramLink);
    }
  }

  if (window.location.pathname === instagramHref) {
    instagramLink.setAttribute('aria-current', 'page');
  }
})();
