// Runs INSIDE the sandboxed SCORM iframe (built to public/scorm-shim.js by `npm run build:scorm-shim`).
// The package content has an opaque origin, so it cannot reach the app (cookies, storage, parent window).
// The SCORM API lives here, in the content's own window, and reports changes to the player with postMessage.

import { createScorm12Api, createScorm2004Api, type ScormSnapshot } from './scorm-api-adapter';

interface Boot {
  version: '1.2' | '2004';
  cmi: Record<string, unknown>;
}

declare global {
  interface Window {
    __SCORM_BOOT?: Boot;
    API?: unknown;
    API_1484_11?: unknown;
  }
}

(function install() {
  const boot = window.__SCORM_BOOT;
  if (!boot) return;
  const send = (type: 'change' | 'commit', snapshot: ScormSnapshot, final: boolean) => {
    try {
      window.parent.postMessage({ source: 'scorm-shim', type, final, snapshot }, '*');
    } catch {
      /* no parent */
    }
  };
  const hooks = {
    onChange: (snapshot: ScormSnapshot) => send('change', snapshot, false),
    onCommit: (snapshot: ScormSnapshot, final: boolean) => send('commit', snapshot, final),
  };
  if (boot.version === '1.2') window.API = createScorm12Api(boot.cmi, hooks);
  else window.API_1484_11 = createScorm2004Api(boot.cmi, hooks);
})();
