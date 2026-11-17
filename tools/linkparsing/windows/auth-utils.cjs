'use strict';
const {isIP} = require('node:net');
const domains = ['douyin.com', 'iesdouyin.com'];
function platformDomain(value) {
  const host = String(value || '').replace(/^\./, '').toLowerCase();
  return domains.some(domain => host === domain || host.endsWith('.' + domain));
}
function loginURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && platformDomain(url.hostname);
  } catch { return false; }
}
function remoteResource(value) {
  try {
    const url = new URL(value);
    if (['data:', 'blob:'].includes(url.protocol)) return true;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return ['https:', 'wss:'].includes(url.protocol) && !url.username && !url.password && !url.port
      && !isIP(host) && host.includes('.') && !/\.(localhost|local|internal)$/i.test(host);
  } catch { return false; }
}
function douyinShare(value) {
  const urls = String(value || '').match(/https?:\/\/[^\s<>"，。！？；（）【】]+/g) || [];
  return urls.length === 1 && loginURL(urls[0]);
}
function cookieText(cookies, now = Date.now() / 1000) {
  const rows = new Map();
  for (const cookie of cookies) {
    if (!platformDomain(cookie.domain) || cookie.partitionKey) continue;
    if (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= now)) continue;
    if (!cookie.name || [cookie.domain, cookie.path, cookie.name, cookie.value].some(v => typeof v !== 'string' || /[\x00-\x1f\x7f]/.test(v))) continue;
    if (!cookie.path.startsWith('/')) continue;
    const expiry = cookie.expirationDate === undefined ? 0 : Math.floor(cookie.expirationDate);
    const row = [cookie.httpOnly ? '#HttpOnly_' + cookie.domain : cookie.domain,
      cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE', cookie.path, cookie.secure ? 'TRUE' : 'FALSE', expiry, cookie.name, cookie.value].join('\t');
    rows.set([cookie.domain, cookie.path, cookie.name].join('\t'), row);
  }
  if (!rows.size) return null;
  const text = '# Netscape HTTP Cookie File\n' + [...rows.values()].join('\n') + '\n';
  if (Buffer.byteLength(text) > 1024 * 1024) throw Error('登录数据过大，请移除本机登录后重试。');
  return text;
}
module.exports = {platformDomain, loginURL, remoteResource, douyinShare, cookieText};
