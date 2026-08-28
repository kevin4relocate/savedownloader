(() => {
  const productionHosts = new Set(["savedownloader.com", "www.savedownloader.com"]);
  if (!productionHosts.has(window.location.hostname)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", "G-07B50P20QM");

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=G-07B50P20QM";
  document.head.appendChild(script);
})();
