import { Readable } from 'node:stream';

// net.fetch rejects manual redirects. Adapt net.request so the shared security
// policy can inspect every redirect before making the next system-network request.
export function createSystemFetch(makeRequest) {
  return async (url, { signal, headers = {}, redirect = 'manual' } = {}) => {
    signal?.throwIfAborted();
    if (redirect !== 'manual') throw Error('Manual redirects required');
    return new Promise((resolve, reject) => {
      const request = makeRequest({ url, method: 'GET', redirect: 'manual', headers, useSessionCookies: false, cache: 'no-store' });
      const abort = () => { request.abort(); reject(signal?.reason ?? Error('aborted')); };
      signal?.addEventListener('abort', abort, { once: true });
      request.on('close', () => signal?.removeEventListener('abort', abort));
      request.on('error', reject);
      request.on('login', (_info, callback) => callback());
      request.on('redirect', (status, _method, location) => {
        resolve(new Response(null, { status, headers: { location } }));
        request.abort();
      });
      request.on('response', response => {
        const responseHeaders = new Headers();
        for (const [key, values] of Object.entries(response.headers)) for (const value of Array.isArray(values) ? values : [values]) responseHeaders.append(key, value);
        response.on('aborted', () => response.destroy(signal?.reason ?? Error('aborted')));
        resolve(new Response([204, 304].includes(response.statusCode) ? null : Readable.toWeb(response), { status: response.statusCode, headers: responseHeaders }));
      });
      request.end();
    });
  };
}
