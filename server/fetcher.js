'use strict';
// 拉取远程订阅,带内存缓存 + 磁盘兜底(上游挂了仍能吐出上次的节点)
const store = require('./store');
const { parseContent } = require('./parsers');

const mem = new Map(); // id -> { at, proxies, userinfo }
const TTL = () => (Number(process.env.CACHE_TTL) || 300) * 1000;
const MAX_BYTES = 10 * 1024 * 1024;

async function fetchText(url, ua) {
  if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http/https 链接');
  const res = await fetch(url, { headers: { 'user-agent': ua || 'clash.meta' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('订阅内容超过 10MB');
  return { text: buf.toString('utf8'), userinfo: res.headers.get('subscription-userinfo') || '' };
}

async function loadNodes(sub, force = false) {
  if (sub.source === 'local') {
    const r = parseContent(sub.content);
    if (!sub.meta || sub.meta.count !== r.proxies.length) { sub.meta = { count: r.proxies.length, at: Date.now(), userinfo: '', error: '' }; store.save(); }
    return { proxies: r.proxies, userinfo: '' };
  }
  const hit = mem.get(sub.id);
  if (!force && hit && Date.now() - hit.at < TTL()) return { proxies: structuredClone(hit.proxies), userinfo: hit.userinfo };

  const urls = String(sub.url || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let proxies = [], userinfo = '', error = '';
  try {
    if (!urls.length) throw new Error('未填写订阅链接');
    for (const u of urls) {
      const r = await fetchText(u, sub.ua);
      proxies = proxies.concat(parseContent(r.text).proxies);
      if (!userinfo) userinfo = r.userinfo;
    }
    if (!proxies.length) throw new Error('未解析出任何节点(格式不支持或内容为空)');
    mem.set(sub.id, { at: Date.now(), proxies, userinfo });
    store.writeCache(sub.id, { proxies, userinfo });
  } catch (e) {
    error = e.name === 'TimeoutError' ? '拉取超时(20s)' : (e.message === 'fetch failed' ? '无法连接上游' + (e.cause && (e.cause.code || e.cause.message) ? `(${e.cause.code || e.cause.message})` : '') : e.message);
    const disk = (hit && { proxies: hit.proxies, userinfo: hit.userinfo }) || store.readCache(sub.id);
    proxies = disk ? disk.proxies : [];
    userinfo = disk ? disk.userinfo : '';
  }
  sub.meta = { count: proxies.length, at: error && sub.meta ? sub.meta.at : Date.now(), userinfo, error, stale: !!error && proxies.length > 0 };
  store.save();
  return { proxies: structuredClone(proxies), userinfo };
}

const invalidate = (id) => mem.delete(id);

module.exports = { loadNodes, invalidate };
