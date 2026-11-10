'use strict';
// 节点操作流水线:过滤 / 改名 / 排序 / 去重 / 设置属性

// 兼容 mihomo 写法:前缀 (?i) 表示忽略大小写
function mkRegex(pattern, extraFlags = '') {
  let src = String(pattern || '');
  let flags = extraFlags;
  if (src.startsWith('(?i)')) { src = src.slice(4); if (!flags.includes('i')) flags += 'i'; }
  return new RegExp(src, flags);
}

function applyOps(list, ops) {
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || op.off) continue;
    const a = op.a == null ? '' : String(op.a);
    const b = op.b == null ? '' : String(op.b);
    try {
      switch (op.type) {
        case 'include': { if (!a) break; const re = mkRegex(a); list = list.filter((p) => re.test(p.name)); break; }
        case 'exclude': { if (!a) break; const re = mkRegex(a); list = list.filter((p) => !re.test(p.name)); break; }
        case 'types': {
          const set = new Set(a.toLowerCase().split(/[,\s]+/).filter(Boolean));
          if (set.size) list = list.filter((p) => set.has(String(p.type).toLowerCase()));
          break;
        }
        case 'rename': { if (!a) break; const re = mkRegex(a, 'g'); for (const p of list) p.name = p.name.replace(re, b).trim() || p.name; break; }
        case 'affix': for (const p of list) p.name = a + p.name + b; break;
        case 'sort': list = [...list].sort((x, y) => x.name.localeCompare(y.name, 'zh-Hans-CN', { numeric: true }) * (a === 'desc' ? -1 : 1)); break;
        case 'dedupe': {
          const seen = new Set();
          list = list.filter((p) => { const k = [p.type, p.server, p.port, p.uuid || p.password || ''].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
          break;
        }
        case 'set': if (['udp', 'skip-cert-verify', 'tfo'].includes(a)) for (const p of list) p[a] = b !== 'false'; break;
        default: break;
      }
    } catch { /* 单条规则写错(如非法正则)时跳过,不影响整体输出 */ }
  }
  return list;
}

// mihomo 要求节点名唯一
function uniqueNames(list) {
  const used = new Set();
  for (const p of list) {
    let name = p.name, i = 1;
    while (used.has(name)) name = `${p.name} ${++i}`;
    used.add(name);
    p.name = name;
  }
  return list;
}

module.exports = { applyOps, uniqueNames, mkRegex };
