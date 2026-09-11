// Entry point. The screens bootstrap themselves from auth.js on window load;
// this file keeps the cross-cutting wiring that does not belong to one screen.

// The register/sign-in switches are anchors, so give them keyboard parity.
['goRegister', 'goLogin'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
});

// Warn once if the API is unreachable, so a stopped server does not look like
// a silently broken page.
api.health().catch(() => {
  showToast('Cannot reach the server — is it running?');
});

// The demo account is only advertised outside production, so a live studio
// deployment never shows working credentials on its own login screen.
api
  .getConfig()
  .then(cfg => {
    if (!cfg.isDevelopment || !cfg.demoEmail) return;
    const hint = document.getElementById('demoHint');
    hint.innerHTML =
      'Admin demo: <code></code> / <code>admin123</code>';
    hint.querySelector('code').textContent = cfg.demoEmail;
    hint.classList.remove('hidden');
  })
  .catch(() => {
    /* the hint simply stays hidden */
  });
