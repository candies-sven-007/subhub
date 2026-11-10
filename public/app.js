'use strict';
/* SubHub 前端 — 原生 JS 单页应用,无外部依赖 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 隐私模式下忽略 */ } } };

let token = LS.get('subhub_token') || '';
let S = null;
let view = 'home';

const ICON = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><path d="M12 4a8 8 0 0 1 8 8M12 20a8 8 0 0 1-8-8M4.6 8.2A8 8 0 0 1 8.2 4.6M19.4 15.8a8 8 0 0 1-3.6 3.6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M9.5 20.5v-6h5v6"/></svg>',
  subs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0"/><path d="M5 12a7 7 0 0 1 7 7M5 5.5A13.5 13.5 0 0 1 18.5 19"/></svg>',
  cols: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>',
  tpls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5M9 13h6M9 16.5h4"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 1-4.5L16.5 4a2 2 0 0 1 3 3L8 18.5z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg>',
};
const NAV = [['home', '概览'], ['subs', '订阅'], ['cols', '组合'], ['tpls', '模板'], ['set', '设置']];
const TARGETS = [['auto', '自动识别客户端'], ['mihomo', 'Mihomo / Clash'], ['uri', '通用 Base64'], ['json', 'JSON 节点']];
const OPS = {
  include: ['保留匹配', '正则,如 港|HK', null], exclude: ['排除匹配', '正则,如 过期|官网|剩余', null],
  rename: ['正则改名', '匹配正则', '替换为(可留空)'], affix: ['加前后缀', '前缀', '后缀'],
  types: ['仅保留协议', 'vless,hysteria2,tuic', null], sort: ['按名称排序', 'asc 或 desc', null],
  dedupe: ['去除重复节点', null, null], set: ['设置属性', 'udp / skip-cert-verify / tfo', 'true 或 false'],
};

// ---------- 基础 ----------
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* 非 JSON 响应 */ }
  if (r.status === 401 && path !== '/login') { token = ''; LS.set('subhub_token', null); render(); throw new Error('登录已过期,请重新登录'); }
  if (!r.ok) throw new Error(j.error || `请求失败 (${r.status})`);
  return j;
}
function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toast').append(el);
  setTimeout(() => el.remove(), bad ? 4200 : 2200);
}
const fail = (e) => toast(e.message || String(e), true);
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('已复制到剪贴板');
}
const bytes = (n) => { if (!(n > 0)) return '0'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024))); return (n / 1024 ** i).toFixed(i > 1 ? 1 : 0) + ' ' + u[i]; };
const ago = (t) => { if (!t) return '从未'; const s = (Date.now() - t) / 1000; if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前'; if (s < 86400) return Math.floor(s / 3600) + ' 小时前'; return Math.floor(s / 86400) + ' 天前'; };
function usage(info) {
  if (!info) return null;
  const o = {};
  for (const kv of info.split(';')) { const [k, v] = kv.split('='); if (k && v) o[k.trim()] = Number(v); }
  if (!o.total) return null;
  return { used: (o.upload || 0) + (o.download || 0), total: o.total, expire: o.expire };
}
const subUrl = (item, target, tpl) => {
  const q = new URLSearchParams();
  if (target) q.set('target', target);
  if (tpl) q.set('tpl', tpl);
  const s = q.toString();
  return `${location.origin}/s/${item.token}${s ? '?' + s : ''}`;
};
const tplName = (id) => (S.templates.find((t) => t.id === id) || {}).name;
const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
const tplOptions = (cur, first = '不使用模板(仅输出节点)') => opt([['', first], ...S.templates.map((t) => [t.id, t.name])], cur || '');

function setTheme(t) {
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name=theme-color]').content = dark ? '#0c1022' : '#dfe9ff';
}
setTheme(LS.get('subhub_theme'));

// ---------- 弹层 ----------
function modal(title, body, footer, onMount) {
  $('#modal').innerHTML = `<div class="mask" data-act="mask"><section class="sheet glass" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="btn icon" data-act="close" aria-label="关闭">${ICON.x}</button></header>
    <div class="body">${body}</div><footer>${footer || ''}</footer></section></div>`;
  if (onMount) onMount($('#modal .sheet'));
}
const closeModal = () => { $('#modal').innerHTML = ''; };

// ---------- 节点操作编辑器 ----------
function opsEditor(root, ops) {
  const draw = () => {
    root.innerHTML = `<span class="lbl">节点操作(按顺序执行)</span><div class="form" style="gap:8px">${ops.map((o, i) => {
      const d = OPS[o.type] || OPS.include;
      return `<div class="oprow" data-i="${i}"><select class="in" data-k="type" aria-label="操作类型">${opt(Object.entries(OPS).map(([k, v]) => [k, v[0]]), o.type)}</select>
        ${d[1] ? `<input class="in" data-k="a" placeholder="${esc(d[1])}" value="${esc(o.a)}">` : '<span></span>'}
        ${d[2] ? `<input class="in" data-k="b" placeholder="${esc(d[2])}" value="${esc(o.b)}">` : '<span></span>'}
        <button class="btn icon del" data-k="del" aria-label="删除这条操作">${ICON.x}</button></div>`;
    }).join('')}</div><div style="margin-top:8px"><button class="btn sm" data-k="add">${ICON.plus}添加操作</button></div>`;
  };
  root.addEventListener('input', (e) => { const row = e.target.closest('.oprow'); const k = e.target.dataset.k; if (row && (k === 'a' || k === 'b')) ops[+row.dataset.i][k] = e.target.value; });
  root.addEventListener('change', (e) => { const row = e.target.closest('.oprow'); if (row && e.target.dataset.k === 'type') { ops[+row.dataset.i] = { type: e.target.value, a: '', b: '' }; draw(); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k === 'add') { ops.push({ type: 'exclude', a: '', b: '' }); draw(); }
    if (b.dataset.k === 'del') { ops.splice(+b.closest('.oprow').dataset.i, 1); draw(); }
  });
  draw();
}

// ---------- 视图 ----------
function metaLine(s) {
  const m = s.meta || {};
  const u = usage(m.userinfo);
  let h = `<div class="row"><span class="pill acc">${m.count ?? 0} 个节点</span><span class="pill">${s.source === 'local' ? '本地内容' : '远程订阅'}</span>${s.templateId && tplName(s.templateId) ? `<span class="pill">模板:${esc(tplName(s.templateId))}</span>` : ''}${m.error ? `<span class="pill ${m.stale ? 'warn' : 'bad'}">${m.stale ? '使用缓存' : '拉取失败'}</span>` : ''}</div>`;
  if (u) h += `<div><div class="bar"><i style="width:${Math.min(100, (u.used / u.total) * 100).toFixed(1)}%"></i></div><div class="tiny" style="margin-top:5px">已用 ${bytes(u.used)} / ${bytes(u.total)}${u.expire ? ' · 到期 ' + new Date(u.expire * 1000).toLocaleDateString('zh-CN') : ''}</div></div>`;
  if (m.error) h += `<div class="err">${esc(m.error)}</div>`;
  return h;
}
function itemButtons(kind, id, refresh) {
  return `<div class="row" style="margin-top:auto"><button class="btn sm primary" data-act="link" data-kind="${kind}" data-id="${id}">${ICON.link}获取链接</button>
    ${refresh ? `<button class="btn sm" data-act="refresh" data-id="${id}">${ICON.sync}刷新</button>` : ''}
    <button class="btn sm" data-act="edit-${kind}" data-id="${id}">${ICON.edit}编辑</button>
    <button class="btn sm icon danger" data-act="del-${kind}" data-id="${id}" aria-label="删除">${ICON.del}</button></div>`;
}
const VIEWS = {
  home() {
    const nodes = S.subs.reduce((n, s) => n + ((s.meta && s.meta.count) || 0), 0);
    const stat = (n, l) => `<div class="glass stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    return `<div class="head"><div><h1>概览</h1><p>一个域名,管好所有订阅</p></div></div>
      <div class="grid stats">${stat(S.subs.length, '订阅')}${stat(nodes, '节点')}${stat(S.collections.length, '组合')}${stat(S.templates.length, '模板')}</div>
      <div class="glass card"><h3>快速导入</h3><p class="muted">粘贴新的订阅链接,选一个模板,直接得到可用的配置地址。</p>
        <form class="form" data-form="quick">
          <div class="cols"><label class="f"><span>名称</span><input class="in" name="name" placeholder="例如:主力机场" required maxlength="60"></label>
          <label class="f"><span>套用模板</span><select class="in" name="templateId">${tplOptions('')}</select></label></div>
          <label class="f"><span>订阅链接</span><input class="in" name="url" type="url" placeholder="https://example.com/sub?token=..." required></label>
          <div><button class="btn primary" type="submit">${ICON.plus}导入并生成链接</button></div>
        </form></div>
      ${S.templates.length ? '' : `<div class="glass card" style="margin-top:16px"><h3>还没有模板</h3><p class="muted">把你现有的 Clash / Mihomo 配置 YAML 丢进来,SubHub 会自动抽掉节点、保留策略组和规则,做成可复用的模板。</p><div><button class="btn" data-act="new-tpl">${ICON.plus}上传 YAML 做成模板</button></div></div>`}`;
  },
  subs() {
    return `<div class="head"><div><h1>订阅</h1><p>远程链接或本地节点,各自带一条输出地址</p></div><button class="btn primary" data-act="edit-sub">${ICON.plus}添加订阅</button></div>
      ${S.subs.length ? `<div class="grid cards">${S.subs.map((s) => `<article class="glass card"><div class="row between"><h3>${esc(s.name)}</h3><span class="tiny">${s.source === 'local' ? '' : ago(s.meta && s.meta.at)}</span></div>${metaLine(s)}${itemButtons('sub', s.id, s.source !== 'local')}</article>`).join('')}</div>`
    : `<div class="glass empty"><b>还没有订阅</b>添加一条机场订阅链接,或直接粘贴节点 URI / YAML。</div>`}`;
  },
  cols() {
    return `<div class="head"><div><h1>组合</h1><p>把多个订阅合并成一条地址</p></div><button class="btn primary" data-act="edit-col"${S.subs.length ? '' : ' disabled'}>${ICON.plus}新建组合</button></div>
      ${S.collections.length ? `<div class="grid cards">${S.collections.map((c) => {
    const names = c.subIds.map((id) => (S.subs.find((s) => s.id === id) || {}).name).filter(Boolean);
    return `<article class="glass card"><h3>${esc(c.name)}</h3><div class="row"><span class="pill acc">${names.length} 个订阅</span>${c.templateId && tplName(c.templateId) ? `<span class="pill">模板:${esc(tplName(c.templateId))}</span>` : ''}</div><p class="muted">${names.map(esc).join(' + ') || '(包含的订阅已被删除)'}</p>${itemButtons('col', c.id, false)}</article>`;
  }).join('')}</div>` : `<div class="glass empty"><b>还没有组合</b>${S.subs.length ? '把几个订阅的节点合并、统一过滤后一起输出。' : '先添加至少一个订阅,再来创建组合。'}</div>`}`;
  },
  tpls() {
    return `<div class="head"><div><h1>模板</h1><p>丢一份 YAML 进来,以后任何订阅都能套用</p></div><button class="btn primary" data-act="new-tpl">${ICON.plus}上传 YAML</button></div>
      ${S.templates.length ? `<div class="grid cards">${S.templates.map((t) => {
    const review = (t.rules || []).filter((r) => r.review).length;
    return `<article class="glass card"><h3>${esc(t.name)}</h3><div class="row"><span class="pill acc">${(t.rules || []).length} 个策略组</span>${t.stats ? `<span class="pill">${t.stats.rules} 条规则</span>` : ''}${(t.statics || []).length ? `<span class="pill ok">${t.statics.length} 个固定节点</span>` : ''}${review ? `<span class="pill warn">${review} 个组待确认</span>` : ''}</div>
      <p class="muted">${(t.rules || []).slice(0, 6).map((r) => esc(r.name)).join(' · ')}${(t.rules || []).length > 6 ? ' …' : ''}</p>
      <div class="row" style="margin-top:auto"><button class="btn sm primary" data-act="edit-tpl" data-id="${t.id}">${ICON.edit}编辑填充规则</button><button class="btn sm icon danger" data-act="del-tpl" data-id="${t.id}" aria-label="删除">${ICON.del}</button></div></article>`;
  }).join('')}</div>` : `<div class="glass empty"><b>还没有模板</b>上传一份完整的 Clash / Mihomo 配置,节点会被抽掉,策略组、规则、DNS 等全部保留。</div>`}`;
  },
  set() {
    const th = LS.get('subhub_theme') || 'auto';
    return `<div class="head"><div><h1>设置</h1><p>SubHub v${esc(S.version)}</p></div></div>
      <div class="grid cards">
        <div class="glass card"><h3>外观</h3><div><div class="seg">${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${th === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
        <div class="glass card"><h3>备份与恢复</h3><p class="muted">导出全部订阅、组合和模板为一个 JSON 文件。恢复会覆盖现有数据。</p><div class="row"><button class="btn" data-act="backup">导出备份</button><button class="btn" data-act="restore">从备份恢复</button></div></div>
        <div class="glass card"><h3>账号</h3><p class="muted">${S.passwordFromEnv ? '管理密码来自环境变量 ADMIN_PASSWORD,修改后重启容器生效。' : '当前使用自动生成的管理密码(见启动日志)。建议设置环境变量 ADMIN_PASSWORD。'}</p><div><button class="btn danger" data-act="logout">退出登录</button></div></div>
      </div>`;
  },
};

function render() {
  const app = $('#app');
  if (!token) {
    app.innerHTML = `<div class="login"><form class="glass box form" data-form="login"><div><div class="logo">${ICON.logo}</div><h1>SubHub</h1><p>订阅管理与转换</p></div>
      <input class="in" type="password" name="password" placeholder="管理密码" autocomplete="current-password" required aria-label="管理密码">
      <button class="btn primary" type="submit">登录</button></form></div>`;
    return;
  }
  if (!S) { app.innerHTML = '<div class="login"><div class="muted">加载中…</div></div>'; return; }
  const nav = (cls) => NAV.map(([k, l]) => `<button class="nav${view === k ? ' on' : ''}" data-act="nav" data-v="${k}"${view === k ? ' aria-current="page"' : ''}>${ICON[k]}<span>${l}</span></button>`).join('');
  const brand = `<div class="brand"><div class="logo">${ICON.logo}</div><div><b>SubHub</b><small>订阅中枢</small></div></div>`;
  app.innerHTML = `<div class="shell"><aside class="side glass">${brand}${nav()}<div class="grow"></div><div class="ver">v${esc(S.version)}</div></aside>
    <main class="main"><div class="mtop">${brand}</div>${VIEWS[view]()}</main></div><nav class="tabbar glass" aria-label="主导航">${nav()}</nav>`;
}
async function reload() { S = await api('GET', '/state'); render(); }

// ---------- 各类弹层 ----------
function linkDialog(kind, id) {
  const item = (kind === 'sub' ? S.subs : S.collections).find((x) => x.id === id);
  if (!item) return;
  modal(`「${item.name}」的订阅地址`, `<div class="form">
      <div class="cols"><label class="f"><span>输出格式</span><select class="in" id="lk-target">${opt([['', '按默认设置'], ...TARGETS.slice(1)], '')}</select></label>
      <label class="f"><span>模板(仅 Mihomo 格式生效)</span><select class="in" id="lk-tpl">${opt([['', '按默认设置'], ['none', '不使用模板'], ...S.templates.map((t) => [t.id, t.name])], '')}</select></label></div>
      <label class="f"><span>地址(填进客户端即可)</span><input class="in" id="lk-url" readonly></label>
      <div id="lk-out"></div></div>`,
  `<button class="btn" data-k="regen">重置地址</button><button class="btn" data-k="preview">预览输出</button><button class="btn primary" data-k="copy">复制地址</button>`,
  (root) => {
    const url = () => subUrl(item, $('#lk-target').value, $('#lk-tpl').value);
    const sync = () => { $('#lk-url').value = url(); };
    sync();
    root.addEventListener('change', sync);
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-k]'); if (!b) return;
      try {
        if (b.dataset.k === 'copy') await copy(url());
        if (b.dataset.k === 'preview') {
          $('#lk-out').innerHTML = '<p class="muted">生成中…</p>';
          // 浏览器里无法伪装客户端 UA,「自动识别」时按 Mihomo 格式预览
          const tg = $('#lk-target').value || item.target || 'auto';
          const r = await fetch(subUrl(item, tg === 'auto' ? 'mihomo' : tg, $('#lk-tpl').value));
          const text = await r.text();
          $('#lk-out').innerHTML = `<pre class="out"></pre>`;
          $('#lk-out pre').textContent = r.ok ? text.slice(0, 200000) : `出错了(HTTP ${r.status}):${text}`;
        }
        if (b.dataset.k === 'regen') {
          if (!confirm('重置后旧地址立刻失效,客户端需要换成新地址。继续吗?')) return;
          Object.assign(item, await api('POST', `/${kind === 'sub' ? 'subs' : 'collections'}/${id}/token`));
          sync(); toast('已生成新地址');
        }
      } catch (err) { fail(err); }
    });
  });
}

function outputFields(d) {
  return `<div class="cols"><label class="f"><span>默认输出格式</span><select class="in" name="target">${opt(TARGETS, d.target || 'auto')}</select></label>
    <label class="f"><span>默认模板</span><select class="in" name="templateId">${tplOptions(d.templateId)}</select></label></div>`;
}

function subDialog(id) {
  const old = S.subs.find((x) => x.id === id);
  const d = old ? JSON.parse(JSON.stringify(old)) : { name: '', source: 'remote', url: '', content: '', ua: '', ops: [], target: 'auto', templateId: '' };
  d.ops = d.ops || [];
  modal(old ? '编辑订阅' : '添加订阅', `<form class="form" id="f-sub">
      <label class="f"><span>名称</span><input class="in" name="name" value="${esc(d.name)}" required maxlength="60" placeholder="例如:主力机场"></label>
      <div><div class="seg" id="src"><button type="button" data-v="remote">远程链接</button><button type="button" data-v="local">本地内容</button></div></div>
      <div id="src-remote" class="form"><label class="f"><span>订阅链接(多条链接每行一个)</span><textarea class="in" name="url" style="min-height:76px" placeholder="https://example.com/sub?token=...">${esc(d.url)}</textarea></label>
        <label class="f"><span>拉取时使用的 User-Agent(留空为 clash.meta)</span><input class="in" name="ua" value="${esc(d.ua)}" placeholder="clash.meta"></label></div>
      <div id="src-local"><label class="f"><span>节点内容(URI 每行一个、Base64 或含 proxies 的 YAML)</span><textarea class="in" name="content" placeholder="vless://...&#10;hysteria2://...">${esc(d.content)}</textarea></label></div>
      ${outputFields(d)}<div id="ops"></div></form>`,
  `<button class="btn" data-act="close">取消</button><button class="btn primary" id="save">保存</button>`,
  (root) => {
    const setSrc = (v) => { d.source = v; $$('#src button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); $('#src-remote').hidden = v !== 'remote'; $('#src-local').hidden = v !== 'local'; };
    setSrc(d.source);
    $('#src').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSrc(b.dataset.v); });
    opsEditor($('#ops'), d.ops);
    $('#save', root).addEventListener('click', async (e) => {
      const f = Object.fromEntries(new FormData($('#f-sub')));
      const body = { ...f, source: d.source, ops: d.ops };
      e.target.disabled = true; e.target.textContent = '保存并拉取中…';
      try {
        const r = await api(old ? 'PUT' : 'POST', old ? `/subs/${id}` : '/subs', body);
        closeModal(); await reload();
        r.meta && r.meta.error ? toast('已保存,但拉取失败:' + r.meta.error, true) : toast(`已保存,共 ${(r.meta && r.meta.count) || 0} 个节点`);
      } catch (err) { fail(err); e.target.disabled = false; e.target.textContent = '保存'; }
    });
  });
}

function colDialog(id) {
  const old = S.collections.find((x) => x.id === id);
  const d = old ? JSON.parse(JSON.stringify(old)) : { name: '', subIds: [], ops: [], target: 'auto', templateId: '' };
  d.ops = d.ops || [];
  modal(old ? '编辑组合' : '新建组合', `<form class="form" id="f-col">
      <label class="f"><span>名称</span><input class="in" name="name" value="${esc(d.name)}" required maxlength="60" placeholder="例如:全部节点"></label>
      <div><span class="lbl">包含的订阅</span><div class="checks">${S.subs.map((s) => `<label class="check"><input type="checkbox" name="sub" value="${s.id}"${d.subIds.includes(s.id) ? ' checked' : ''}><span>${esc(s.name)}</span><span class="tiny" style="margin-left:auto">${(s.meta && s.meta.count) || 0} 节点</span></label>`).join('')}</div></div>
      ${outputFields(d)}<div id="ops"></div></form>`,
  `<button class="btn" data-act="close">取消</button><button class="btn primary" id="save">保存</button>`,
  (root) => {
    opsEditor($('#ops'), d.ops);
    $('#save', root).addEventListener('click', async () => {
      const fd = new FormData($('#f-col'));
      const body = { name: fd.get('name'), target: fd.get('target'), templateId: fd.get('templateId'), subIds: fd.getAll('sub'), ops: d.ops };
      try { await api(old ? 'PUT' : 'POST', old ? `/collections/${id}` : '/collections', body); closeModal(); await reload(); toast('已保存'); } catch (err) { fail(err); }
    });
  });
}

function newTplDialog() {
  modal('上传 YAML 做成模板', `<div class="form">
      <label class="f"><span>模板名称</span><input class="in" id="tp-name" maxlength="60" placeholder="例如:我的分流规则"></label>
      <div class="drop" id="tp-drop" tabindex="0" role="button">点这里选择 .yaml / .yml 文件,或把文件拖进来</div><input type="file" id="tp-file" accept=".yaml,.yml,.txt,text/yaml,text/plain" hidden>
      <label class="f"><span>或者直接粘贴配置内容</span><textarea class="in" id="tp-yaml" placeholder="proxies:&#10;  - ...&#10;proxy-groups:&#10;  - ...&#10;rules:&#10;  - ..."></textarea></label>
      <label class="f"><span>配置里自带的节点怎么处理</span><select class="in" id="tp-keep">${opt([['auto', '自动判断(推荐)'], ['yes', '保留为固定节点(自建落地 / 链式代理)'], ['no', '当作示例节点移除']], 'auto')}</select></label>
      <p class="tiny">自动判断:策略组用 use 引用 proxy-providers,或节点带 dialer-proxy 时,自带节点视为你自建的固定节点并保留;否则视为机场示例节点移除。proxy-providers 会被移除,策略组、规则、DNS 等原样保留,注释不保留。</p></div>`,
  `<button class="btn" data-act="close">取消</button><button class="btn primary" id="save">生成模板</button>`,
  (root) => {
    const load = (file) => { if (!file) return; if (file.size > 5 * 1024 * 1024) return toast('文件超过 5MB', true); const r = new FileReader(); r.onload = () => { $('#tp-yaml').value = r.result; if (!$('#tp-name').value) $('#tp-name').value = file.name.replace(/\.(ya?ml|txt)$/i, ''); $('#tp-drop').textContent = '已读取:' + file.name; }; r.readAsText(file); };
    const drop = $('#tp-drop');
    drop.addEventListener('click', () => $('#tp-file').click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#tp-file').click(); } });
    $('#tp-file').addEventListener('change', (e) => load(e.target.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); });
    $('#save', root).addEventListener('click', async () => {
      try {
        const t = await api('POST', '/templates', { name: $('#tp-name').value, yaml: $('#tp-yaml').value, keep: $('#tp-keep').value });
        await reload(); view = 'tpls'; render(); tplDialog(t.id);
        toast(`模板已生成:${t.rules.length} 个策略组` + (t.statics.length ? `,保留 ${t.statics.length} 个固定节点` : ''));
      } catch (err) { fail(err); }
    });
  });
}

function tplDialog(id) {
  const t = S.templates.find((x) => x.id === id);
  if (!t) return;
  const rules = JSON.parse(JSON.stringify(t.rules || []));
  const MODES = [['all', '放入全部节点'], ['filter', '按正则筛选节点'], ['none', '不放节点(只保留原有引用)']];
  modal('编辑模板', `<form class="form" id="f-tpl">
      <label class="f"><span>模板名称</span><input class="in" name="name" value="${esc(t.name)}" required maxlength="60"></label>
      <div><span class="lbl">固定节点 / 链式代理</span><p class="tiny" style="margin:0 4px 8px">固定节点始终保留在配置里,不随订阅变化。给它指定「前置组」后,流量会先经过该组当前选中的节点,再到这个落地节点。</p>
        <div class="form" style="gap:8px" id="statics"></div>
        <details style="margin-top:8px"><summary>添加落地节点</summary><div class="form" style="gap:10px;margin-top:8px">
          <textarea class="in" id="st-add" style="min-height:84px" placeholder="粘贴节点 URI(每行一个)或含 proxies 的 YAML" spellcheck="false"></textarea>
          <div class="cols"><label class="f"><span>前置组(dialer-proxy)</span><select class="in" id="st-dialer"></select></label>
          <label class="f"><span>加入到策略组</span><select class="in" id="st-group"></select></label></div></div></details></div>
      <div><span class="lbl">每个策略组放哪些订阅节点</span><div class="form" style="gap:10px" id="rules"></div></div>
      <details><summary>高级:直接编辑模板骨架 YAML</summary><textarea class="in" name="base" style="min-height:240px;margin-top:8px" spellcheck="false">${esc(t.base)}</textarea></details></form>`,
  `<button class="btn" data-act="close">取消</button><button class="btn primary" id="save">保存</button>`,
  (root) => {
    const box = $('#rules');
    const draw = () => {
      box.innerHTML = rules.length ? rules.map((r, i) => `<div class="rule${r.review ? ' review' : ''}" data-i="${i}">
          <div class="row between"><b style="overflow-wrap:anywhere">${esc(r.name)}</b><span class="pill">${esc(r.type)}</span></div>
          ${r.review ? '<div class="tiny" style="color:var(--warn)">原配置里这个组只含部分节点,没能推断出规律,暂时放入全部节点,请确认。</div>' : ''}
          <select class="in" data-k="mode" aria-label="填充方式">${opt(MODES, r.mode)}</select>
          ${r.mode === 'filter' ? `<input class="in" data-k="filter" placeholder="保留正则,如 (?i)港|HK" value="${esc(r.filter)}" aria-label="保留正则">` : ''}
          ${r.mode !== 'none' ? `<input class="in" data-k="exclude" placeholder="排除正则(可留空),如 过期|官网" value="${esc(r.exclude)}" aria-label="排除正则">` : ''}</div>`).join('')
        : '<p class="muted">这份配置里没有 proxy-groups,套用时只会把节点写入 proxies。</p>';
    };
    box.addEventListener('input', (e) => { const el = e.target.closest('.rule'); const k = e.target.dataset.k; if (el && (k === 'filter' || k === 'exclude')) rules[+el.dataset.i][k] = e.target.value; });
    box.addEventListener('change', (e) => { const el = e.target.closest('.rule'); if (el && e.target.dataset.k === 'mode') { const r = rules[+el.dataset.i]; r.mode = e.target.value; r.review = false; draw(); } });
    draw();
    // 固定节点
    const statics = JSON.parse(JSON.stringify(t.statics || []));
    const removed = new Set();
    const gopts = (cur, none) => opt([['', none], ...rules.map((r) => [r.name, r.name])], cur);
    const sbox = $('#statics');
    const drawS = () => {
      const live = statics.filter((s) => !removed.has(s.name));
      sbox.innerHTML = live.length ? live.map((s) => `<div class="strow" data-n="${esc(s.name)}"><div style="min-width:0"><b style="overflow-wrap:anywhere">${esc(s.name)}</b> <span class="pill">${esc(s.type)}</span></div>
          <select class="in" data-k="dialer" aria-label="前置组">${gopts(s.dialer, '直连(不走前置)')}</select>
          <button type="button" class="btn icon del" data-k="rm" aria-label="删除这个固定节点">${ICON.x}</button></div>`).join('')
        : '<p class="muted">这个模板里没有固定节点。</p>';
    };
    sbox.addEventListener('change', (e) => { const row = e.target.closest('.strow'); if (row && e.target.dataset.k === 'dialer') statics.find((s) => s.name === row.dataset.n).dialer = e.target.value; });
    sbox.addEventListener('click', (e) => { const b = e.target.closest('button[data-k=rm]'); if (b) { removed.add(b.closest('.strow').dataset.n); drawS(); } });
    drawS();
    const guess = (re) => (rules.find((r) => re.test(r.name)) || {}).name || '';
    $('#st-dialer').innerHTML = gopts(guess(/中转|前置|relay/i), '直连(不走前置)');
    $('#st-group').innerHTML = gopts(guess(/落地|landing|exit/i), '不加入任何组');
    $('#save', root).addEventListener('click', async () => {
      const f = Object.fromEntries(new FormData($('#f-tpl')));
      const edit = { remove: [...removed], dialers: Object.fromEntries(statics.filter((s) => !removed.has(s.name)).map((s) => [s.name, s.dialer])), add: { content: $('#st-add').value, dialer: $('#st-dialer').value, group: $('#st-group').value } };
      try { await api('PUT', `/templates/${id}`, { name: f.name, base: f.base, rules: rules.map((r) => ({ ...r, review: false })), statics: edit }); closeModal(); await reload(); toast('模板已保存'); } catch (err) { fail(err); }
    });
  });
}

// ---------- 事件 ----------
const ACT = {
  nav: (b) => { view = b.dataset.v; render(); scrollTo(0, 0); },
  close: closeModal,
  mask: (b, e) => { if (e.target === b) closeModal(); },
  link: (b) => linkDialog(b.dataset.kind, b.dataset.id),
  'edit-sub': (b) => subDialog(b.dataset.id),
  'edit-col': (b) => colDialog(b.dataset.id),
  'edit-tpl': (b) => tplDialog(b.dataset.id),
  'new-tpl': newTplDialog,
  refresh: async (b) => { b.disabled = true; const r = await api('POST', `/subs/${b.dataset.id}/refresh`); await reload(); r.meta && r.meta.error ? toast('拉取失败:' + r.meta.error, true) : toast(`已刷新,共 ${r.meta.count} 个节点`); },
  'del-sub': (b) => del('subs', b.dataset.id, '订阅'),
  'del-col': (b) => del('collections', b.dataset.id, '组合'),
  'del-tpl': (b) => del('templates', b.dataset.id, '模板'),
  theme: (b) => { LS.set('subhub_theme', b.dataset.v === 'auto' ? null : b.dataset.v); setTheme(b.dataset.v); render(); },
  logout: () => { token = ''; S = null; LS.set('subhub_token', null); render(); },
  backup: async () => {
    const data = await api('GET', '/backup');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `subhub-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  },
  restore: () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm('恢复会覆盖当前全部订阅、组合和模板。继续吗?')) return;
        await api('POST', '/restore', data); await reload(); toast('已恢复');
      } catch (err) { fail(err instanceof SyntaxError ? new Error('备份文件不是合法 JSON') : err); }
    };
    inp.click();
  },
};
async function del(path, id, what) {
  if (!confirm(`确定删除这个${what}吗?对应的订阅地址会立刻失效。`)) return;
  await api('DELETE', `/${path}/${id}`); await reload(); toast('已删除');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !ACT[b.dataset.act]) return;
  try { await ACT[b.dataset.act](b, e); } catch (err) { fail(err); if (b.disabled) b.disabled = false; }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    if (form.dataset.form === 'login') {
      token = (await api('POST', '/login', f)).token; LS.set('subhub_token', token); await reload();
    } else if (form.dataset.form === 'quick') {
      const r = await api('POST', '/subs', { ...f, source: 'remote', target: 'auto', ops: [] });
      await reload();
      r.meta && r.meta.error ? toast('已导入,但拉取失败:' + r.meta.error, true) : toast(`已导入 ${r.meta.count} 个节点`);
      linkDialog('sub', r.id);
    }
  } catch (err) { fail(err); btn.disabled = false; }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTheme(LS.get('subhub_theme')));

render();
if (token) reload().catch(() => {});
