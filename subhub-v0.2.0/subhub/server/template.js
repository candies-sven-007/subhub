'use strict';
// YAML 模板引擎:
//   analyze() 把一份完整的 Clash/Mihomo 配置拆成「骨架 + 每个策略组的节点填充规则」
//   render()  把任意节点列表按规则灌回骨架,得到完整配置
const YAML = require('yaml');
const { mkRegex } = require('./ops');

const REGIONS = [
  '港|HK|Hong ?Kong', '台|TW|Taiwan', '日本|日|JP|Japan|东京|大阪', '新加坡|狮城|新|SG|Singapore',
  '美国|美|US|United ?States|America', '韩|KR|Korea', '英国|英|UK|GB|United ?Kingdom|伦敦|London',
  '德|DE|Germany', '法|FR|France', '马来|MY|Malaysia', '澳|AU|Australia', '加拿大|CA|Canada',
  '印度|IN|India', '俄|RU|Russia', '土耳其|TR|Turkey', '荷兰|NL|Netherlands', '泰|TH|Thailand', '越|VN|Vietnam',
];

const sameSet = (a, b) => a.length === b.size && a.every((x) => b.has(x));

function inferFilter(groupName, subset, allNames) {
  const want = new Set(subset);
  const hit = (pat) => { const re = new RegExp(pat, 'i'); return sameSet(allNames.filter((n) => re.test(n)), want); };
  const byName = REGIONS.filter((pat) => new RegExp(pat, 'i').test(groupName));
  for (const pat of [...byName, ...REGIONS]) if (hit(pat)) return `(?i)${pat}`;
  return null;
}

function parseDoc(text) {
  let doc;
  try { doc = YAML.parse(String(text || ''), { merge: true }); } catch (e) { throw new Error('YAML 解析失败:' + e.message.split('\n')[0]); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('这不是一份有效的配置文件(顶层应为键值对)');
  return doc;
}

const DUMP = { lineWidth: 0, aliasDuplicateObjects: false };
const validNode = (p) => p && typeof p === 'object' && p.name != null && p.type;
const usesProviders = (g) => g && ((Array.isArray(g.use) && g.use.length) || g['include-all'] || g['include-all-proxies'] || g['include-all-providers']);

// keep: 'auto' | 'yes' | 'no' —— 配置里自带的节点是否保留为「固定节点」
//   auto:策略组通过 use 引用订阅,或节点带 dialer-proxy 时,自带节点视为自建的固定节点(如链式代理的落地),予以保留
function analyze(text, keep = 'auto') {
  const doc = parseDoc(text);
  const proxies = Array.isArray(doc.proxies) ? doc.proxies.filter(validNode) : [];
  const groups = Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : [];
  // 自带节点与订阅并存的两个信号:策略组引用了 proxy-providers,或节点本身带 dialer-proxy
  const fromProviders = groups.some((g) => g && ((Array.isArray(g.use) && g.use.length) || g['include-all-providers']));
  const keepStatic = proxies.length > 0 && (keep === 'yes' || (keep !== 'no' && (fromProviders || proxies.some((p) => p['dialer-proxy']))));
  const allNames = keepStatic ? [] : proxies.map((p) => String(p.name));
  const nodeSet = new Set(allNames);
  const rules = [];

  for (const g of groups) {
    if (!g || g.name == null) continue;
    const members = Array.isArray(g.proxies) ? g.proxies.map(String) : [];
    const refs = members.filter((m) => !nodeSet.has(m));
    const nodes = members.filter((m) => nodeSet.has(m));
    const rule = { name: String(g.name), type: g.type || 'select', mode: 'none', filter: '', exclude: '', review: false };

    if (usesProviders(g)) {
      rule.mode = g.filter ? 'filter' : 'all';
      rule.filter = g.filter ? String(g.filter) : '';
      rule.exclude = g['exclude-filter'] ? String(g['exclude-filter']) : '';
    } else if (nodes.length && nodes.length === nodeSet.size) {
      rule.mode = 'all';
    } else if (nodes.length) {
      const f = inferFilter(rule.name, nodes, allNames);
      if (f) { rule.mode = 'filter'; rule.filter = f; }
      else { rule.mode = 'all'; rule.review = true; } // 推断不出规律,先放全部节点,提示人工确认
    }
    rules.push(rule);

    g.proxies = refs;
    for (const k of ['use', 'include-all', 'include-all-proxies', 'include-all-providers', 'filter', 'exclude-filter']) delete g[k];
  }

  if (keepStatic) doc.proxies = proxies; else delete doc.proxies;
  delete doc['proxy-providers'];
  return {
    base: YAML.stringify(doc, DUMP), rules, keptStatic: keepStatic,
    stats: { nodes: proxies.length, statics: keepStatic ? proxies.length : 0, groups: rules.length, rules: Array.isArray(doc.rules) ? doc.rules.length : 0 },
  };
}

// 模板里保留的固定节点摘要(给界面用,不含密码等敏感字段)
function listStatics(base) {
  try {
    const doc = parseDoc(base);
    return (Array.isArray(doc.proxies) ? doc.proxies : []).filter(validNode)
      .map((p) => ({ name: String(p.name), type: String(p.type), dialer: p['dialer-proxy'] ? String(p['dialer-proxy']) : '' }));
  } catch { return []; }
}

// 编辑固定节点:改前置代理(dialer-proxy)、删除、追加
//   edit = { dialers: {节点名: 组名|''}, remove: [节点名], add: { proxies: [...], dialer, group } }
function editStatics(base, edit) {
  const doc = parseDoc(base);
  let list = (Array.isArray(doc.proxies) ? doc.proxies : []).filter(validNode);
  const groups = (Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : []).filter((g) => g && g.name != null);
  const gmap = new Map(groups.map((g) => [String(g.name), g]));
  const members = (g) => (Array.isArray(g.proxies) ? g.proxies.map(String) : []);
  const checkDialer = (node, dialer) => {
    if (!dialer) return;
    const g = gmap.get(dialer);
    if (!g) throw new Error(`前置组「${dialer}」不存在`);
    if (members(g).includes(node)) throw new Error(`「${dialer}」组里包含节点「${node}」自身,会形成回环`);
  };

  const remove = new Set((edit.remove || []).map(String));
  if (remove.size) {
    list = list.filter((p) => !remove.has(String(p.name)));
    for (const g of groups) if (Array.isArray(g.proxies)) g.proxies = g.proxies.filter((m) => !remove.has(String(m)));
  }
  const dialers = edit.dialers || {};
  for (const p of list) {
    const name = String(p.name);
    if (!Object.prototype.hasOwnProperty.call(dialers, name)) continue;
    const d = String(dialers[name] || '');
    checkDialer(name, d);
    if (d) p['dialer-proxy'] = d; else delete p['dialer-proxy'];
  }
  const add = edit.add;
  if (add && Array.isArray(add.proxies) && add.proxies.length) {
    const used = new Set([...list.map((p) => String(p.name)), ...gmap.keys(), 'DIRECT', 'REJECT']);
    const dialer = String(add.dialer || '');
    const target = add.group ? gmap.get(String(add.group)) : null;
    if (add.group && !target) throw new Error(`策略组「${add.group}」不存在`);
    if (dialer && !gmap.has(dialer)) throw new Error(`前置组「${dialer}」不存在`);
    if (dialer && target && String(target.name) === dialer) throw new Error('落地节点不能加入它自己的前置组,会形成回环');
    for (const p of add.proxies) {
      let name = String(p.name), i = 1;
      while (used.has(name)) name = `${p.name} ${++i}`;
      used.add(name);
      const node = { ...p, name };
      if (dialer) node['dialer-proxy'] = dialer; else delete node['dialer-proxy'];
      list.push(node);
      if (target) target.proxies = [...members(target), name];
    }
  }
  if (list.length) doc.proxies = list; else delete doc.proxies;
  return YAML.stringify(doc, DUMP);
}

// 骨架被手动编辑后,让规则列表与骨架里的策略组保持一致
function syncRules(base, oldRules) {
  const doc = parseDoc(base);
  const groups = Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : [];
  const map = new Map((oldRules || []).map((r) => [r.name, r]));
  return groups.filter((g) => g && g.name != null).map((g) => {
    const o = map.get(String(g.name)) || {};
    const mode = ['all', 'filter', 'none'].includes(o.mode) ? o.mode : 'none';
    return { name: String(g.name), type: g.type || 'select', mode, filter: String(o.filter || ''), exclude: String(o.exclude || ''), review: !!o.review };
  });
}

function pick(rule, names) {
  if (!rule || rule.mode === 'none') return [];
  let out = names;
  if (rule.mode === 'filter' && rule.filter) { try { const re = mkRegex(rule.filter); out = out.filter((n) => re.test(n)); } catch { out = []; } }
  if (rule.exclude) { try { const re = mkRegex(rule.exclude); out = out.filter((n) => !re.test(n)); } catch { /* 忽略非法排除正则 */ } }
  return out;
}

function render(template, proxies) {
  const doc = parseDoc(template.base);
  const groups = (Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : []).filter((g) => g && g.name != null);
  const statics = (Array.isArray(doc.proxies) ? doc.proxies : []).filter(validNode);
  // 订阅节点不能与固定节点 / 策略组 / 内置出口重名
  const used = new Set([...statics.map((p) => String(p.name)), ...groups.map((g) => String(g.name)), 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
  for (const p of proxies) {
    let name = p.name, i = 1;
    while (used.has(name)) name = `${p.name} ${++i}`;
    used.add(name);
    p.name = name;
  }
  const names = proxies.map((p) => p.name);
  const map = new Map((template.rules || []).map((r) => [r.name, r]));
  for (const g of groups) {
    const refs = Array.isArray(g.proxies) ? g.proxies.map(String) : [];
    const list = [...refs, ...pick(map.get(String(g.name)), names)];
    g.proxies = list.length ? list : ['DIRECT']; // 空组会让内核报错,兜底 DIRECT
  }
  // 固定节点在前、订阅节点在后,整体放在 proxy-groups 之前
  const all = [...statics, ...proxies];
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'proxies') continue;
    if (k === 'proxy-groups' && !placed) { out.proxies = all; placed = true; }
    out[k] = v;
  }
  if (!placed) out.proxies = all;
  return YAML.stringify(out, DUMP);
}

module.exports = { analyze, render, syncRules, listStatics, editStatics };
