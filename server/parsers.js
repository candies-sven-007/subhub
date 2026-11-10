'use strict';
// 订阅内容解析(→ mihomo 风格节点对象)与输出(节点 → URI / YAML)
const YAML = require('yaml');

const b64d = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
};
const b64e = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = encodeURIComponent;
const truthy = (v) => v === '1' || v === 'true';

// 拆分 scheme://[userinfo@]host:port[/path][?query][#name]
function splitUri(line) {
  const m = line.match(/^([a-z0-9+.-]+):\/\/([^#]*)(?:#(.*))?$/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  let body = m[2];
  const name = m[3] ? dec(m[3]).trim() : '';
  const q = {};
  const qi = body.indexOf('?');
  if (qi >= 0) {
    for (const kv of body.slice(qi + 1).split('&')) {
      if (!kv) continue;
      const i = kv.indexOf('=');
      const k = i < 0 ? kv : kv.slice(0, i);
      q[dec(k)] = i < 0 ? '' : dec(kv.slice(i + 1).replace(/\+/g, '%20'));
    }
    body = body.slice(0, qi);
  }
  body = body.replace(/\/+$/, '');
  const at = body.lastIndexOf('@');
  const userinfo = at >= 0 ? body.slice(0, at) : '';
  const hostport = at >= 0 ? body.slice(at + 1) : body;
  let host = '', portStr = '';
  if (hostport.startsWith('[')) {
    const e = hostport.indexOf(']');
    host = hostport.slice(1, e);
    portStr = hostport.slice(e + 2);
  } else {
    const c = hostport.lastIndexOf(':');
    host = c >= 0 ? hostport.slice(0, c) : hostport;
    portStr = c >= 0 ? hostport.slice(c + 1) : '';
  }
  return { scheme, userinfo, host, portStr, port: parseInt(portStr, 10), q, name, raw: m[2] };
}

function applyTls(p, q, sniKey) {
  if (q.sni || q.peer) p[sniKey] = q.sni || q.peer;
  if (q.fp) p['client-fingerprint'] = q.fp;
  if (q.alpn) p.alpn = q.alpn.split(',').map((s) => s.trim()).filter(Boolean);
  if (truthy(q.allowInsecure) || truthy(q.insecure) || truthy(q.allow_insecure)) p['skip-cert-verify'] = true;
}

function applyTransport(p, q) {
  const net = q.type || 'tcp';
  const host = q.host, path = q.path;
  if (net === 'ws' || net === 'httpupgrade') {
    p.network = 'ws';
    const o = {};
    if (path) o.path = path;
    if (host) o.headers = { Host: host };
    if (net === 'httpupgrade') o['v2ray-http-upgrade'] = true;
    p['ws-opts'] = o;
  } else if (net === 'grpc') {
    p.network = 'grpc';
    p['grpc-opts'] = { 'grpc-service-name': q.serviceName || '' };
  } else if (net === 'h2' || (net === 'http' && !q.headerType)) {
    p.network = 'h2';
    const o = {};
    if (host) o.host = host.split(',');
    if (path) o.path = path;
    p['h2-opts'] = o;
  } else if (net === 'tcp' && q.headerType === 'http') {
    p.network = 'http';
    const o = { path: [path || '/'] };
    if (host) o.headers = { Host: host.split(',') };
    p['http-opts'] = o;
  } else if (net !== 'tcp') {
    p.network = net; // 未专门适配的传输层,原样透传
  }
}

const P = {};

P.vless = (u) => {
  const { q } = u;
  const p = { name: u.name, type: 'vless', server: u.host, port: u.port, uuid: dec(u.userinfo), udp: true };
  if (q.flow) p.flow = q.flow;
  if (q.security === 'tls' || q.security === 'reality') {
    p.tls = true;
    applyTls(p, q, 'servername');
    if (q.security === 'reality') p['reality-opts'] = { 'public-key': q.pbk || '', 'short-id': q.sid || '' };
  }
  applyTransport(p, q);
  return p;
};

P.trojan = (u) => {
  const { q } = u;
  const p = { name: u.name, type: 'trojan', server: u.host, port: u.port, password: dec(u.userinfo), udp: true };
  applyTls(p, q, 'sni');
  applyTransport(p, q);
  return p;
};

P.vmess = (u) => {
  let j;
  try { j = JSON.parse(b64d(u.raw)); } catch { return null; }
  const p = {
    name: String(j.ps || ''), type: 'vmess', server: j.add, port: parseInt(j.port, 10),
    uuid: j.id, alterId: parseInt(j.aid, 10) || 0, cipher: j.scy || 'auto', udp: true,
  };
  if (j.tls === 'tls') {
    p.tls = true;
    if (j.sni || j.host) p.servername = j.sni || j.host;
    if (j.fp) p['client-fingerprint'] = j.fp;
    if (j.alpn) p.alpn = String(j.alpn).split(',');
  }
  const net = j.net || 'tcp';
  if (net === 'ws') {
    p.network = 'ws';
    const o = { path: j.path || '/' };
    if (j.host) o.headers = { Host: j.host };
    p['ws-opts'] = o;
  } else if (net === 'grpc') {
    p.network = 'grpc';
    p['grpc-opts'] = { 'grpc-service-name': j.path || '' };
  } else if (net === 'h2') {
    p.network = 'h2';
    p['h2-opts'] = { host: j.host ? String(j.host).split(',') : [], path: j.path || '/' };
  } else if (net === 'tcp' && j.type === 'http') {
    p.network = 'http';
    p['http-opts'] = { path: [j.path || '/'], ...(j.host ? { headers: { Host: String(j.host).split(',') } } : {}) };
  }
  return p;
};

P.ss = (u) => {
  let method, password, host = u.host, port = u.port;
  if (u.userinfo) {
    let ui = dec(u.userinfo);
    if (!ui.includes(':')) ui = b64d(u.userinfo);
    const i = ui.indexOf(':');
    method = ui.slice(0, i); password = ui.slice(i + 1);
  } else {
    // 旧格式:ss://base64(method:pass@host:port)
    const d = b64d(u.raw.split('?')[0]);
    const m = d.match(/^(.+?):(.*)@(.+):(\d+)$/);
    if (!m) return null;
    [, method, password, host] = m; port = parseInt(m[4], 10);
  }
  const p = { name: u.name, type: 'ss', server: host, port, cipher: method, password, udp: true };
  if (u.q.plugin) {
    const parts = u.q.plugin.split(';');
    const o = {};
    for (const s of parts.slice(1)) { const i = s.indexOf('='); if (i < 0) o[s] = true; else o[s.slice(0, i)] = s.slice(i + 1); }
    if (/obfs/.test(parts[0])) { p.plugin = 'obfs'; p['plugin-opts'] = { mode: o.obfs || 'http', ...(o['obfs-host'] ? { host: o['obfs-host'] } : {}) }; }
    else if (/v2ray/.test(parts[0])) { p.plugin = 'v2ray-plugin'; p['plugin-opts'] = { mode: 'websocket', ...(o.tls ? { tls: true } : {}), ...(o.host ? { host: o.host } : {}), ...(o.path ? { path: o.path } : {}) }; }
  }
  return p;
};

P.hysteria2 = P.hy2 = (u) => {
  const { q } = u;
  const p = { name: u.name, type: 'hysteria2', server: u.host, port: u.port, password: dec(u.userinfo) };
  const extra = u.portStr.includes(',') ? u.portStr.slice(u.portStr.indexOf(',') + 1) : '';
  if (q.mport || extra) p.ports = q.mport || extra;
  applyTls(p, q, 'sni');
  if (q.obfs && q.obfs !== 'none') { p.obfs = q.obfs; if (q['obfs-password']) p['obfs-password'] = q['obfs-password']; }
  return p;
};

P.tuic = (u) => {
  const { q } = u;
  const ui = dec(u.userinfo); const i = ui.indexOf(':');
  const p = { name: u.name, type: 'tuic', server: u.host, port: u.port, uuid: i < 0 ? ui : ui.slice(0, i), password: i < 0 ? '' : ui.slice(i + 1) };
  applyTls(p, q, 'sni');
  if (q.congestion_control) p['congestion-controller'] = q.congestion_control;
  if (q.udp_relay_mode) p['udp-relay-mode'] = q.udp_relay_mode;
  if (truthy(q.disable_sni)) p['disable-sni'] = true;
  return p;
};

P.anytls = (u) => {
  const p = { name: u.name, type: 'anytls', server: u.host, port: u.port, password: dec(u.userinfo), udp: true };
  applyTls(p, u.q, 'sni');
  return p;
};

function parseUri(line) {
  const u = splitUri(line.trim());
  if (!u || !P[u.scheme]) return null;
  let p;
  try { p = P[u.scheme](u); } catch { return null; }
  if (!p || !p.server || !Number.isFinite(p.port)) return null;
  if (!p.name) p.name = `${p.type}-${p.server}:${p.port}`;
  return p;
}

const validProxy = (p) => p && typeof p === 'object' && p.name != null && p.type && p.server && p.port != null;

// 自动识别:Clash/Mihomo YAML、base64 URI 列表、明文 URI 列表
function parseContent(text) {
  text = String(text || '').replace(/^﻿/, '').trim();
  if (!text) return { proxies: [], format: 'empty', skipped: 0 };
  if (/^\s*proxies\s*:/m.test(text)) {
    try {
      const doc = YAML.parse(text, { merge: true });
      if (doc && Array.isArray(doc.proxies)) {
        const ok = doc.proxies.filter(validProxy).map((p) => ({ ...p, name: String(p.name) }));
        return { proxies: ok, format: 'yaml', skipped: doc.proxies.length - ok.length };
      }
    } catch { /* 不是合法 YAML,继续尝试其它格式 */ }
  }
  if (!text.includes('://')) {
    try { const d = b64d(text); if (d.includes('://')) text = d; } catch { /* ignore */ }
  }
  const proxies = []; let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) continue;
    const p = parseUri(s);
    if (p) proxies.push(p); else skipped++;
  }
  return { proxies, format: 'uri', skipped };
}

// ---------- 输出:节点 → URI ----------
function tlsQuery(p, sniKey, q) {
  if (p[sniKey]) q.sni = p[sniKey];
  if (p['client-fingerprint']) q.fp = p['client-fingerprint'];
  if (Array.isArray(p.alpn) && p.alpn.length) q.alpn = p.alpn.join(',');
  if (p['skip-cert-verify']) q.insecure = '1';
}
function transportQuery(p, q) {
  const n = p.network;
  if (n === 'ws') {
    const o = p['ws-opts'] || {};
    q.type = o['v2ray-http-upgrade'] ? 'httpupgrade' : 'ws';
    if (o.path) q.path = o.path;
    if (o.headers && o.headers.Host) q.host = o.headers.Host;
  } else if (n === 'grpc') {
    q.type = 'grpc';
    q.serviceName = (p['grpc-opts'] || {})['grpc-service-name'] || '';
  } else if (n === 'h2') {
    const o = p['h2-opts'] || {};
    q.type = 'h2';
    if (o.path) q.path = o.path;
    if (o.host && o.host.length) q.host = [].concat(o.host).join(',');
  } else if (n === 'http') {
    const o = p['http-opts'] || {};
    q.type = 'tcp'; q.headerType = 'http';
    if (o.path) q.path = [].concat(o.path)[0];
    if (o.headers && o.headers.Host) q.host = [].concat(o.headers.Host).join(',');
  } else if (n && n !== 'tcp') q.type = n;
}
const qs = (q) => { const s = Object.entries(q).map(([k, v]) => `${k}=${enc(v)}`).join('&'); return s ? '?' + s : ''; };
const hp = (p) => `${String(p.server).includes(':') ? `[${p.server}]` : p.server}:${p.port}`;

function toUri(p) {
  const tag = '#' + enc(p.name);
  const q = {};
  switch (p.type) {
    case 'vless': {
      q.encryption = 'none';
      if (p.flow) q.flow = p.flow;
      if (p.tls) {
        const r = p['reality-opts'];
        q.security = r ? 'reality' : 'tls';
        tlsQuery(p, 'servername', q);
        if (r) { q.pbk = r['public-key'] || ''; if (r['short-id']) q.sid = r['short-id']; }
      } else q.security = 'none';
      transportQuery(p, q);
      return `vless://${p.uuid}@${hp(p)}${qs(q)}${tag}`;
    }
    case 'trojan':
      tlsQuery(p, 'sni', q); transportQuery(p, q);
      return `trojan://${enc(p.password)}@${hp(p)}${qs(q)}${tag}`;
    case 'vmess': {
      const j = { v: '2', ps: p.name, add: p.server, port: String(p.port), id: p.uuid, aid: String(p.alterId || 0), scy: p.cipher || 'auto', net: 'tcp', type: 'none', host: '', path: '', tls: p.tls ? 'tls' : '' };
      if (p.servername) j.sni = p.servername;
      if (p['client-fingerprint']) j.fp = p['client-fingerprint'];
      if (p.network === 'ws') { const o = p['ws-opts'] || {}; j.net = 'ws'; j.path = o.path || '/'; j.host = (o.headers && o.headers.Host) || ''; }
      else if (p.network === 'grpc') { j.net = 'grpc'; j.path = (p['grpc-opts'] || {})['grpc-service-name'] || ''; }
      else if (p.network === 'h2') { const o = p['h2-opts'] || {}; j.net = 'h2'; j.path = o.path || '/'; j.host = [].concat(o.host || []).join(','); }
      else if (p.network === 'http') { const o = p['http-opts'] || {}; j.type = 'http'; j.path = [].concat(o.path || ['/'])[0]; j.host = [].concat((o.headers && o.headers.Host) || []).join(','); }
      return 'vmess://' + b64e(JSON.stringify(j));
    }
    case 'ss': {
      if (p.plugin === 'obfs') { const o = p['plugin-opts'] || {}; q.plugin = `obfs-local;obfs=${o.mode || 'http'}${o.host ? ';obfs-host=' + o.host : ''}`; }
      else if (p.plugin === 'v2ray-plugin') { const o = p['plugin-opts'] || {}; q.plugin = `v2ray-plugin${o.tls ? ';tls' : ''}${o.host ? ';host=' + o.host : ''}${o.path ? ';path=' + o.path : ''}`; }
      else if (p.plugin) return null;
      return `ss://${b64e(`${p.cipher}:${p.password}`).replace(/=+$/, '')}@${hp(p)}${qs(q)}${tag}`;
    }
    case 'hysteria2':
      tlsQuery(p, 'sni', q);
      if (p.obfs) { q.obfs = p.obfs; if (p['obfs-password']) q['obfs-password'] = p['obfs-password']; }
      if (p.ports) q.mport = p.ports;
      return `hysteria2://${enc(p.password || '')}@${hp(p)}${qs(q)}${tag}`;
    case 'tuic':
      tlsQuery(p, 'sni', q);
      if (p['congestion-controller']) q.congestion_control = p['congestion-controller'];
      if (p['udp-relay-mode']) q.udp_relay_mode = p['udp-relay-mode'];
      if (p['disable-sni']) q.disable_sni = '1';
      return `tuic://${p.uuid}:${enc(p.password || '')}@${hp(p)}${qs(q)}${tag}`;
    case 'anytls':
      tlsQuery(p, 'sni', q);
      return `anytls://${enc(p.password || '')}@${hp(p)}${qs(q)}${tag}`;
    default:
      return null;
  }
}

function produceUri(proxies) {
  const lines = []; let skipped = 0;
  for (const p of proxies) { const u = toUri(p); if (u) lines.push(u); else skipped++; }
  return { text: b64e(lines.join('\n')), skipped };
}

const produceYaml = (proxies) => YAML.stringify({ proxies }, { lineWidth: 0 });

module.exports = { parseContent, parseUri, toUri, produceUri, produceYaml, b64d, b64e };
