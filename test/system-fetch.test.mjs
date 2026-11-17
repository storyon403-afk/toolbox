import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSystemFetch } from '../src/system-fetch.mjs';
import { githubBytes } from '../src/remote-catalog.mjs';

function mock(handler) {
  return createSystemFetch(options => {
    const request = new EventEmitter();
    request.abort = () => { request.aborted = true; request.response?.emit('aborted'); request.emit('close'); };
    request.end = () => queueMicrotask(() => handler(request, options));
    request.reply = (text, status = 200) => {
      const response = new PassThrough(); request.response = response;
      response.statusCode = status; response.headers = { 'content-type': ['text/plain'] };
      response.on('end', () => request.emit('close'));
      request.emit('response', response); response.end(text);
    };
    return request;
  });
}
test('system request exposes redirects to policy without following them', async () => {
  const calls = [];
  const fetcher = mock((request, options) => {
    calls.push(options.url); assert.equal(options.useSessionCookies, false);
    if (calls.length === 1) request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/file');
    else request.reply('payload');
  });
  assert.equal((await githubBytes('https://github.com/file', { fetcher })).toString(), 'payload');
  assert.equal(calls.length, 2);
  const denied = [];
  await assert.rejects(githubBytes('https://github.com/file', { fetcher: mock((request, options) => { denied.push(options.url); request.emit('redirect', 302, 'GET', 'https://evil.example/file'); }) }), /unsafeCatalogSource/);
  assert.equal(denied.length, 1);
});
test('system request propagates connection failures and cancellation while streaming', async () => {
  await assert.rejects(mock(request => request.emit('error', Error('network offline')))('https://github.com/file'), /network offline/);
  const controller = new AbortController();
  const fetcher = mock(request => {
    const response = new PassThrough(); request.response = response; response.statusCode = 200; response.headers = {};
    request.emit('response', response); response.write('partial');
  });
  const response = await fetcher('https://github.com/file', { signal: controller.signal });
  const body = response.text(); controller.abort(Error('cancelled'));
  await assert.rejects(body, /cancelled/);
});
