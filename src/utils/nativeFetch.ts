/**
 * Native HTTP fetch adapter that delegates to Tauri's native Rust HTTP client
 * when running in desktop mode, bypassing browser/WebView CORS restrictions on external APIs.
 */

export async function nativeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== 'undefined' && window.electron?.httpFetch) {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => {
          headers[k] = v;
        });
      } else {
        Object.assign(headers, init.headers);
      }
    }

    try {
      const res = await window.electron.httpFetch({
        url,
        method: init?.method,
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      console.warn('Native fetch via Tauri failed, falling back to standard fetch:', err);
    }
  }

  return fetch(url, init);
}
