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

    let bodyStr: string | undefined;
    let bodyBase64: string | undefined;

    if (init?.body) {
      if (typeof init.body === 'string') {
        bodyStr = init.body;
      } else if (init.body instanceof Uint8Array || init.body instanceof ArrayBuffer) {
        const u8 = init.body instanceof Uint8Array ? init.body : new Uint8Array(init.body);
        let binary = '';
        const len = u8.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(u8[i]);
        }
        bodyBase64 = btoa(binary);
      } else if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
        const arrayBuf = await init.body.arrayBuffer();
        const u8 = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < u8.length; i++) {
          binary += String.fromCharCode(u8[i]);
        }
        bodyBase64 = btoa(binary);
      }
    }

    try {
      const res = await window.electron.httpFetch({
        url,
        method: init?.method,
        headers,
        body: bodyStr,
        bodyBase64,
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
