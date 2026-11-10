'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { produceUri, produceYaml, parseContent } = require('./parsers');
const { applyOps, uniqueNames } = require('./ops');
const tpl = require('./template');
const { loadNodes, invalidate } = require('./fetcher');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const PUB = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

store.load();
const db = () => store.db;

// ---------- 认证 ----------
function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!db().settings.password) {
    db().settings.password = crypto.randomBytes(9).toString('base64url');
    store.save();
  }
  return db().settings.password;
}
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const sign = (exp) => crypto.createHmac('sha256', db().settings.secret).update(String(exp)).digest('base64url');
const issue = () => { const exp = Date.now() + 30 * 864e5; return `${exp}.${sign(exp)}`; };
function authed(req) {
  const m = /^Bearer (\d+)\.([\w-]+)$/.exec(req.headers.authorization || '');
  return !!m && Number(m[1]) > Date.now() && safeEqual(m[2], sign(m[1]));
}
const fails = new Map(); // ip -> { n, until }
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

// ---------- 小工具 ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  const data = isStr ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, '请求体过大')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, '请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);
const cleanOps = (ops) => (Array.isArray(ops) ? ops : []).slice(0, 50).map((o) => ({ type: str(o && o.type, 20), a: str(o && o.a, 500), b: str(o && o.b, 500) }));
const TARGETS = ['auto', 'mihomo', 'uri', 'json'];

function cleanSub(b, old = {}) {
  const name = str(b.name).trim() || bad('名称不能为空');
  const source = b.source === 'local' ? 'local' : 'remote';
  const url = str(b.url, 4000).trim();
  const content = String(b.content || '').slice(0, 5 * 1024 * 1024);
  if (source === 'remote') {
    if (!url) bad('请填写订阅链接');
    for (const u of url.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) if (!/^https?:\/\//i.test(u)) bad('订阅链接必须以 http:// 或 https:// 开头');
  } else if (!content.trim()) bad('请粘贴节点内容');
  return {
    ...old, name, source, url, content, ua: str(b.ua, 200).trim(), ops: cleanOps(b.ops),
    target: TARGETS.includes(b.target) ? b.target : 'auto', templateId: str(b.templateId, 40),
  };
}
function cleanCol(b, old = {}) {
  const name = str(b.name).trim() || bad('名称不能为空');
  const ids = new Set(db().subs.map((s) => s.id));
  const subIds = (Array.isArray(b.subIds) ? b.subIds : []).map(String).filter((i) => ids.has(i));
  if (!subIds.length) bad('请至少选择一个订阅');
  return { ...old, name, subIds, ops: cleanOps(b.ops), target: TARGETS.includes(b.target) ? b.target : 'auto', templateId: str(b.templateId, 40) };
}

// ---------- 生成输出 ----------
async function subNodes(sub, force) {
  const { proxies, userinfo } = await loadNodes(sub, force);
  return { nodes: applyOps(proxies, sub.ops), userinfo };
}
async function buildNodes(kind, item) {
  if (kind === 'sub') return subNodes(item, false);
  const subs = item.subIds.map((id) => db().subs.find((s) => s.id === id)).filter(Boolean);
  const parts = await Promise.all(subs.map((s) => subNodes(s, false)));
  return { nodes: applyOps(parts.flatMap((p) => p.nodes), item.ops), userinfo: parts.length === 1 ? parts[0].userinfo : '' };
}
async function buildOutput(kind, item, query, ua) {
  const { nodes, userinfo } = await buildNodes(kind, item);
  uniqueNames(nodes);
  let target = query.get('target') || item.target || 'auto';
  if (!TARGETS.includes(target)) bad('不支持的 target,可选:mihomo / uri / json');
  if (target === 'auto') target = /clash|mihomo|meta|stash|verge|flclash|nekobox|karing/i.test(ua || '') ? 'mihomo' : 'uri';
  const headers = { 'profile-update-interval': '12' };
  if (userinfo) headers['subscription-userinfo'] = userinfo;
  const fname = encodeURIComponent(item.name);
  if (target === 'json') return { text: JSON.stringify(nodes, null, 2), headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } };
  if (target === 'uri') return { text: produceUri(nodes).text, headers };
  const want = query.has('tpl') ? query.get('tpl') : item.templateId;
  let text;
  if (want && want !== 'none') {
    const t = db().templates.find((x) => x.id === want || x.name === want);
    if (!t) bad('模板不存在:' + want, 404);
    text = tpl.render(t, nodes);
  } else text = produceYaml(nodes);
  headers['content-disposition'] = `attachment; filename*=UTF-8''${fname}.yaml`;
  headers['content-type'] = 'text/yaml; charset=utf-8';
  return { text, headers };
}

// ---------- 路由 ----------
const routes = [];
function on(method, pattern, handler, isPublic = false) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, isPublic });
}
const find = (list, id, what) => list.find((x) => x.id === id) || bad(what + '不存在', 404);
const publicView = () => ({
  version: VERSION, subs: db().subs, collections: db().collections,
  templates: db().templates.map((t) => ({ ...t, statics: tpl.listStatics(t.base) })), passwordFromEnv: !!process.env.ADMIN_PASSWORD,
});

on('POST', '/api/login', async (req) => {
  const ip = clientIp(req);
  const f = fails.get(ip);
  if (f && f.n >= 8 && f.until > Date.now()) bad('尝试次数过多,请 10 分钟后再试', 429);
  const body = await readBody(req, 4096);
  if (!safeEqual(str(body.password, 500), adminPassword())) {
    const cur = f && f.until > Date.now() ? f : { n: 0, until: 0 };
    fails.set(ip, { n: cur.n + 1, until: Date.now() + 600e3 });
    bad('密码错误', 401);
  }
  fails.delete(ip);
  return { token: issue() };
}, true);

on('GET', '/api/state', async () => publicView());

on('POST', '/api/subs', async (req) => {
  const sub = { id: store.id(), token: store.token(), ...cleanSub(await readBody(req)) };
  db().subs.push(sub); store.save();
  await loadNodes(sub, true);
  return sub;
});
on('PUT', '/api/subs/:id', async (req, p) => {
  const i = db().subs.findIndex((x) => x.id === p.id); if (i < 0) bad('订阅不存在', 404);
  const next = cleanSub(await readBody(req), db().subs[i]);
  db().subs[i] = next; store.save(); invalidate(next.id);
  await loadNodes(next, true);
  return next;
});
on('DELETE', '/api/subs/:id', async (req, p) => {
  find(db().subs, p.id, '订阅');
  db().subs = db().subs.filter((x) => x.id !== p.id);
  for (const c of db().collections) c.subIds = c.subIds.filter((i) => i !== p.id);
  store.save(); invalidate(p.id); store.dropCache(p.id);
  return { ok: true };
});
on('POST', '/api/subs/:id/refresh', async (req, p) => { const s = find(db().subs, p.id, '订阅'); await loadNodes(s, true); return s; });
on('POST', '/api/subs/:id/token', async (req, p) => { const s = find(db().subs, p.id, '订阅'); s.token = store.token(); store.save(); return s; });

on('POST', '/api/collections', async (req) => {
  const c = { id: store.id(), token: store.token(), ...cleanCol(await readBody(req)) };
  db().collections.push(c); store.save(); return c;
});
on('PUT', '/api/collections/:id', async (req, p) => {
  const i = db().collections.findIndex((x) => x.id === p.id); if (i < 0) bad('组合不存在', 404);
  db().collections[i] = cleanCol(await readBody(req), db().collections[i]); store.save(); return db().collections[i];
});
on('DELETE', '/api/collections/:id', async (req, p) => {
  find(db().collections, p.id, '组合');
  db().collections = db().collections.filter((x) => x.id !== p.id); store.save(); return { ok: true };
});
on('POST', '/api/collections/:id/token', async (req, p) => { const c = find(db().collections, p.id, '组合'); c.token = store.token(); store.save(); return c; });

const withStatics = (t) => ({ ...t, statics: tpl.listStatics(t.base) });
on('POST', '/api/templates', async (req) => {
  const b = await readBody(req);
  const name = str(b.name).trim() || bad('模板名称不能为空');
  if (db().templates.some((t) => t.name === name)) bad('已存在同名模板');
  let r; try { r = tpl.analyze(b.yaml, ['yes', 'no'].includes(b.keep) ? b.keep : 'auto'); } catch (e) { bad(e.message); }
  const t = { id: store.id(), name, base: r.base, rules: r.rules, stats: r.stats, createdAt: Date.now() };
  db().templates.push(t); store.save(); return withStatics(t);
});
on('PUT', '/api/templates/:id', async (req, p) => {
  const t = find(db().templates, p.id, '模板');
  const b = await readBody(req);
  const name = str(b.name).trim() || bad('模板名称不能为空');
  if (db().templates.some((x) => x.name === name && x.id !== t.id)) bad('已存在同名模板');
  let base = typeof b.base === 'string' ? b.base : t.base;
  let rules;
  try {
    const e = b.statics && typeof b.statics === 'object' ? b.statics : null;
    if (e) {
      const add = e.add && String(e.add.content || '').trim() ? { proxies: parseContent(e.add.content).proxies, dialer: str(e.add.dialer), group: str(e.add.group) } : null;
      if (e.add && String(e.add.content || '').trim() && !add.proxies.length) bad('要添加的落地节点没有解析出任何节点');
      base = tpl.editStatics(base, { dialers: e.dialers, remove: e.remove, add });
    }
    rules = tpl.syncRules(base, Array.isArray(b.rules) ? b.rules : t.rules);
  } catch (err) { if (err instanceof HttpError) throw err; bad(err.message); }
  Object.assign(t, { name, base, rules }); store.save(); return withStatics(t);
});
on('DELETE', '/api/templates/:id', async (req, p) => {
  find(db().templates, p.id, '模板');
  db().templates = db().templates.filter((x) => x.id !== p.id);
  for (const x of [...db().subs, ...db().collections]) if (x.templateId === p.id) x.templateId = '';
  store.save(); return { ok: true };
});

on('GET', '/api/backup', async () => ({ app: 'subhub', version: VERSION, exportedAt: new Date().toISOString(), subs: db().subs, collections: db().collections, templates: db().templates }));
on('POST', '/api/restore', async (req) => {
  const b = await readBody(req, 32 * 1024 * 1024);
  if (b.app !== 'subhub' || !Array.isArray(b.subs) || !Array.isArray(b.templates)) bad('这不是 SubHub 的备份文件');
  const ok = (x) => x && typeof x.id === 'string' && typeof x.name === 'string';
  db().subs = b.subs.filter((x) => ok(x) && typeof x.token === 'string');
  db().collections = (b.collections || []).filter((x) => ok(x) && typeof x.token === 'string' && Array.isArray(x.subIds));
  db().templates = b.templates.filter((x) => ok(x) && typeof x.base === 'string');
  store.save();
  return { ok: true };
});

// 对外订阅地址:/s/<token>?target=mihomo|uri|json&tpl=<模板ID或名称|none>
on('GET', '/s/:token', async (req, p, url, res) => {
  let kind = 'sub';
  let item = db().subs.find((x) => x.token === p.token);
  if (!item) { kind = 'col'; item = db().collections.find((x) => x.token === p.token); }
  if (!item) bad('Not Found', 404);
  const out = await buildOutput(kind, item, url.searchParams, req.headers['user-agent']);
  send(res, 200, out.text, out.headers);
  return undefined;
}, true);

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not Found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Bad Request'); }
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (!r.isPublic && !authed(req)) return send(res, 401, { error: '未登录或登录已过期' });
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const out = await r.handler(req, params, url, res);
      if (out !== undefined) send(res, 200, out);
      return undefined;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/')) return send(res, 404, { error: 'Not Found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('[error]', e);
    return send(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  const pw = adminPassword();
  console.log(`SubHub v${VERSION} 已启动: http://${HOST}:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`未设置 ADMIN_PASSWORD,已自动生成管理密码: ${pw}`);
});
