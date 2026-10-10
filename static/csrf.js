/* AVITECH CSRF protection: automatically attaches the session token to state-changing fetches. */
(() => {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta) return;
  const token = meta.getAttribute("content");
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const method = String(init.method || (input && input.method) || "GET").toUpperCase();
    if (["POST","PUT","PATCH","DELETE"].includes(method)) {
      const headers = new Headers(init.headers || {});
      headers.set("X-CSRF-Token", token);
      init = {...init, headers};
    }
    return originalFetch(input, init);
  };
})();
