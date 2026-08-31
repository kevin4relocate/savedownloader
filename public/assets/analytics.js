(() => {
  const shellScript = document.createElement("script");
  shellScript.src = "/assets/site-shell.js";
  shellScript.async = false;
  document.head.appendChild(shellScript);

  const MEASUREMENT_ID = "G-07B50P20QM";
  const CONSENT_KEY = "sd_analytics_consent_v1";
  const productionHosts = new Set(["savedownloader.com", "www.savedownloader.com"]);
  const analyticsFreePaths = new Set(["/privacy/", "/cookies/"]);
  let consent = null;
  let analyticsLoaded = false;

  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === "granted" || stored === "denied") consent = stored;
  } catch {}

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    if (consent !== "granted" || analyticsFreePaths.has(window.location.pathname)) return;
    window.dataLayer.push(arguments);
  };

  const ensureConsentStyles = () => {
    if (document.querySelector('link[data-consent-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/consent.css";
    link.dataset.consentStyles = "true";
    document.head.appendChild(link);
  };

  const loadAnalytics = () => {
    if (
      analyticsLoaded ||
      consent !== "granted" ||
      analyticsFreePaths.has(window.location.pathname) ||
      !productionHosts.has(window.location.hostname)
    ) return;

    analyticsLoaded = true;

    // Initialize GA4 through the gtag command queue exactly as Google's
    // installation snippet expects. The consent guard above ensures these
    // commands are queued only after analytics consent has been granted.
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID);

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  };

  const removeBanner = () => {
    document.querySelector('[data-consent-banner]')?.remove();
  };

  const persistConsent = (value) => {
    consent = value;
    try { localStorage.setItem(CONSENT_KEY, value); } catch {}
    removeBanner();
    if (value === "granted") loadAnalytics();
  };

  const renderBanner = (force = false) => {
    ensureConsentStyles();
    if (!force && (consent === "granted" || consent === "denied")) return;
    removeBanner();

    const banner = document.createElement("aside");
    banner.className = "consent-banner";
    banner.dataset.consentBanner = "true";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Analytics cookie choices");
    banner.innerHTML = `
      <div class="consent-inner">
        <div class="consent-copy">
          <strong>Analytics cookies</strong>
          <p>We use optional Google Analytics to understand traffic and improve SaveDownloader. You can accept or reject analytics. Essential storage is used only to remember this choice. <a href="/cookies/">Cookies</a> · <a href="/privacy/">Privacy</a></p>
        </div>
        <div class="consent-actions">
          <button class="consent-btn" type="button" data-consent-reject>Reject analytics</button>
          <button class="consent-btn primary" type="button" data-consent-accept>Accept analytics</button>
        </div>
      </div>`;

    banner.querySelector('[data-consent-reject]').addEventListener("click", () => persistConsent("denied"));
    banner.querySelector('[data-consent-accept]').addEventListener("click", () => persistConsent("granted"));
    document.body.appendChild(banner);
  };

  const init = () => {
    ensureConsentStyles();
    document.querySelectorAll('[data-consent-settings]').forEach((control) => {
      control.addEventListener("click", () => renderBanner(true));
    });
    if (consent === "granted") loadAnalytics();
    if (!consent) renderBanner(false);
  };

  window.SaveDownloaderConsent = {
    open: () => renderBanner(true),
    get: () => consent,
    accept: () => persistConsent("granted"),
    reject: () => persistConsent("denied")
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
