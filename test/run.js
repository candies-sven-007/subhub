'use strict';
// 无框架自测:node test/run.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseContent, parseUri, toUri, produceUri, b64d, b64e } = require('../server/parsers');
const { applyOps, uniqueNames } = require('../server/ops');
const tpl = require('../server/template');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

const vmessJson = { v: '2', ps: 'VM 节点', add: 'vm.example.com', port: '443', id: '22222222-2222-2222-2222-222222222222', aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'cdn.example.com', path: '/ws', tls: 'tls', sni: 'cdn.example.com' };
const URIS = [
  'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?encryption=none&security=reality&sni=www.apple.com&fp=chrome&pbk=PUBKEY&sid=ab12&type=tcp&flow=xtls-rprx-vision#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF%20Reality',
  'vless://11111111-1111-1111-1111-111111111111@[2001:db8::1]:8443?security=tls&sni=a.example.com&type=ws&host=a.example.com&path=%2Fpath%3Fed%3D2048#WS-v6',
  'trojan://pass%40word@t.example.com:443?sni=t.example.com&type=grpc&serviceName=grpc#Trojan gRPC',
  'vmess://' + b64e(JSON.stringify(vmessJson)),
  'ss://' + b64e('aes-256-gcm:secret').replace(/=+$/, '') + '@s.example.com:8388#SS%20%E6%97%A5%E6%9C%AC',
  'ss://' + b64e('chacha20-ietf-poly1305:pw@old.example.com:1234') + '#OldSS',
  'hysteria2://hy2pass@h.example.com:443?sni=h.example.com&insecure=1&obfs=salamander&obfs-password=ob&mport=20000-30000#HY2 美国',
  'hy2://x@h2.example.com:8443,9000-9100#HY2-ports',
  'tuic://33333333-3333-3333-3333-333333333333:tpass@tu.example.com:443?sni=tu.example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native#TUIC',
  'anytls://apass@any.example.com:443?sni=any.example.com&insecure=1#AnyTLS',
];

console.log('parsers');
t('解析 10 条 URI', () => {
  const r = parseContent(URIS.join('\n') + '\n# 注释\nnot-a-uri\n');
  assert.strictEqual(r.proxies.length, 10); assert.strictEqual(r.skipped, 1);
  const [reality, v6, trojan, vmess, ss, oldss, hy2, hy2p, tuic, anytls] = r.proxies;
  assert.strictEqual(reality.name, '🇭🇰 香港 Reality');
  assert.deepStrictEqual(reality['reality-opts'], { 'public-key': 'PUBKEY', 'short-id': 'ab12' });
  assert.strictEqual(reality.flow, 'xtls-rprx-vision'); assert.strictEqual(reality.servername, 'www.apple.com');
  assert.strictEqual(v6.server, '2001:db8::1'); assert.strictEqual(v6.port, 8443);
  assert.strictEqual(v6['ws-opts'].path, '/path?ed=2048'); assert.strictEqual(v6['ws-opts'].headers.Host, 'a.example.com');
  assert.strictEqual(trojan.password, 'pass@word'); assert.strictEqual(trojan['grpc-opts']['grpc-service-name'], 'grpc');
  assert.strictEqual(vmess.name, 'VM 节点'); assert.strictEqual(vmess.tls, true); assert.strictEqual(vmess['ws-opts'].path, '/ws');
  assert.strictEqual(ss.cipher, 'aes-256-gcm'); assert.strictEqual(ss.password, 'secret'); assert.strictEqual(ss.name, 'SS 日本');
  assert.strictEqual(oldss.server, 'old.example.com'); assert.strictEqual(oldss.port, 1234); assert.strictEqual(oldss.password, 'pw');
  assert.strictEqual(hy2.ports, '20000-30000'); assert.strictEqual(hy2['skip-cert-verify'], true); assert.strictEqual(hy2.obfs, 'salamander');
  assert.strictEqual(hy2p.port, 8443); assert.strictEqual(hy2p.ports, '9000-9100');
  assert.strictEqual(tuic.uuid, '33333333-3333-3333-3333-333333333333'); assert.strictEqual(tuic.password, 'tpass'); assert.deepStrictEqual(tuic.alpn, ['h3']);
  assert.strictEqual(anytls.type, 'anytls'); assert.strictEqual(anytls.sni, 'any.example.com');
});
t('Base64 整体编码的订阅', () => assert.strictEqual(parseContent(b64e(URIS.join('\n'))).proxies.length, 10));
t('节点 → URI → 节点 往返一致', () => {
  for (const u of URIS) {
    const a = parseUri(u); const b = parseUri(toUri(a));
    assert.deepStrictEqual(b, a, '往返不一致: ' + u);
  }
});
t('produceUri 输出可被重新解析', () => {
  const list = parseContent(URIS.join('\n')).proxies;
  assert.strictEqual(parseContent(b64d(produceUri(list).text)).proxies.length, 10);
});
t('YAML 订阅', () => {
  const r = parseContent(fs.readFileSync(path.join(__dirname, 'sample.yaml'), 'utf8'));
  assert.strictEqual(r.format, 'yaml'); assert.strictEqual(r.proxies.length, 5);
});
t('垃圾输入不抛错', () => { for (const s of ['', '   ', 'hello', 'vless://', 'ss://@@@', 'vmess://!!!', 'proxies: [1,2', '{}']) parseContent(s); });

console.log('ops');
const mk = () => parseContent(URIS.join('\n')).proxies;
t('过滤 / 改名 / 排序 / 去重', () => {
  assert.strictEqual(applyOps(mk(), [{ type: 'include', a: '(?i)hy2' }]).length, 2);
  assert.strictEqual(applyOps(mk(), [{ type: 'exclude', a: 'HY2|TUIC' }]).length, 7);
  assert.strictEqual(applyOps(mk(), [{ type: 'types', a: 'vless, anytls' }]).length, 3);
  assert.strictEqual(applyOps(mk(), [{ type: 'rename', a: '^', b: '[A] ' }])[9].name, '[A] AnyTLS');
  assert.strictEqual(applyOps(mk(), [{ type: 'affix', a: '<', b: '>' }])[9].name, '<AnyTLS>');
  assert.strictEqual(applyOps(mk().concat(mk()), [{ type: 'dedupe' }]).length, 10);
  assert.strictEqual(applyOps(mk(), [{ type: 'include', a: '([' }]).length, 10, '非法正则应被跳过');
  const names = uniqueNames(mk().concat(mk())).map((p) => p.name);
  assert.strictEqual(new Set(names).size, 20);
});

console.log('template');
const sample = fs.readFileSync(path.join(__dirname, 'sample.yaml'), 'utf8');
t('analyze 推断各组规则', () => {
  const r = tpl.analyze(sample);
  const by = Object.fromEntries(r.rules.map((x) => [x.name, x]));
  assert.strictEqual(by['节点选择'].mode, 'all'); assert.strictEqual(by['自动选择'].mode, 'all');
  assert.strictEqual(by['香港'].mode, 'filter'); assert.ok(/港/.test(by['香港'].filter));
  assert.strictEqual(by['日本'].mode, 'filter');
  assert.strictEqual(by['精选'].review, true);
  assert.strictEqual(by['流媒体'].mode, 'filter'); assert.strictEqual(by['流媒体'].filter, '(?i)美|US');
  assert.strictEqual(by['广告拦截'].mode, 'none');
  const base = YAML.parse(r.base);
  assert.strictEqual(base.proxies, undefined);
  assert.deepStrictEqual(base['proxy-groups'][0].proxies, ['自动选择', '香港', '日本', 'DIRECT']);
  assert.strictEqual(base.rules.length, 3); assert.strictEqual(base.dns.enable, true);
});
t('render 把新订阅灌进模板', () => {
  const r = tpl.analyze(sample);
  const nodes = uniqueNames(mk());
  const out = YAML.parse(tpl.render(r, nodes));
  const g = Object.fromEntries(out['proxy-groups'].map((x) => [x.name, x.proxies]));
  assert.strictEqual(out.proxies.length, 10);
  assert.strictEqual(g['节点选择'].length, 14);
  assert.deepStrictEqual(g['香港'], ['🇭🇰 香港 Reality']);
  assert.deepStrictEqual(g['日本'], ['SS 日本']);
  assert.deepStrictEqual(g['流媒体'], ['HY2 美国']);
  assert.deepStrictEqual(g['广告拦截'], ['REJECT', 'DIRECT']);
  const all = new Set([...out.proxies.map((p) => p.name), ...out['proxy-groups'].map((x) => x.name), 'DIRECT', 'REJECT']);
  for (const x of out['proxy-groups']) for (const m of x.proxies) assert.ok(all.has(m), '悬空引用: ' + m);
  assert.deepStrictEqual(Object.keys(out).slice(-3), ['proxies', 'proxy-groups', 'rules']);
});
t('空匹配的组兜底 DIRECT', () => {
  const r = tpl.analyze(sample);
  const out = YAML.parse(tpl.render(r, [{ name: 'only', type: 'ss', server: 'x', port: 1 }]));
  assert.deepStrictEqual(out['proxy-groups'].find((x) => x.name === '香港').proxies, ['DIRECT']);
});
t('非法模板报错', () => { assert.throws(() => tpl.analyze('- a\n- b')); assert.throws(() => tpl.analyze('a: [')); });

console.log('chain');
const chain = fs.readFileSync(path.join(__dirname, 'chain.yaml'), 'utf8');
const subNodes = () => [{ name: 'HK 01', type: 'ss', server: 'a', port: 1 }, { name: '落地 A', type: 'ss', server: 'b', port: 2 }, { name: '中转', type: 'ss', server: 'c', port: 3 }];
t('自带节点保留为固定节点,use 组填订阅节点', () => {
  const r = tpl.analyze(chain);
  assert.strictEqual(r.keptStatic, true);
  const by = Object.fromEntries(r.rules.map((x) => [x.name, x.mode]));
  assert.deepStrictEqual(by, { 手动选择: 'all', 中转: 'all', 落地: 'none', Telegram: 'all' });
  assert.deepStrictEqual(tpl.listStatics(r.base), [{ name: '落地 A', type: 'ss', dialer: '中转' }, { name: '落地 B', type: 'trojan', dialer: '中转' }]);
  const text = tpl.render(r, subNodes());
  assert.ok(!/<<|\*tpl|proxy-providers/.test(text), '锚点应被展开,providers 应被移除');
  const out = YAML.parse(text);
  const g = Object.fromEntries(out['proxy-groups'].map((x) => [x.name, x.proxies]));
  assert.deepStrictEqual(out.proxies.map((p) => p.name), ['落地 A', '落地 B', 'HK 01', '落地 A 2', '中转 2'], '订阅节点与固定节点/组重名时改名');
  assert.deepStrictEqual(g['中转'], ['HK 01', '落地 A 2', '中转 2'], '中转组只含订阅节点,不会回环');
  assert.deepStrictEqual(g['落地'], ['落地 A', '落地 B']);
  assert.deepStrictEqual(g['手动选择'].slice(0, 3), ['中转', '落地', 'DIRECT']);
  assert.strictEqual(out.proxies[0]['dialer-proxy'], '中转');
  assert.strictEqual(out['rule-providers'].cn.type, 'http');
});
t('keep=no 时按旧逻辑移除自带节点', () => {
  const r = tpl.analyze(chain, 'no');
  assert.strictEqual(r.keptStatic, false); assert.deepStrictEqual(tpl.listStatics(r.base), []);
});
t('编辑固定节点:改前置 / 删除 / 追加 / 防回环', () => {
  const r = tpl.analyze(chain);
  let base = tpl.editStatics(r.base, { dialers: { '落地 A': '' }, remove: ['落地 B'] });
  assert.deepStrictEqual(tpl.listStatics(base), [{ name: '落地 A', type: 'ss', dialer: '' }]);
  assert.deepStrictEqual(YAML.parse(base)['proxy-groups'].find((x) => x.name === '落地').proxies, ['落地 A']);
  const add = parseContent('ss://' + b64e('aes-128-gcm:pw') + '@new.example.com:1#%E8%90%BD%E5%9C%B0%20A').proxies;
  base = tpl.editStatics(base, { add: { proxies: add, dialer: '中转', group: '落地' } });
  assert.deepStrictEqual(tpl.listStatics(base).map((x) => [x.name, x.dialer]), [['落地 A', ''], ['落地 A 2', '中转']]);
  assert.deepStrictEqual(YAML.parse(base)['proxy-groups'].find((x) => x.name === '落地').proxies, ['落地 A', '落地 A 2']);
  assert.throws(() => tpl.editStatics(base, { dialers: { '落地 A': '落地' } }), /回环/);
  assert.throws(() => tpl.editStatics(base, { add: { proxies: add, dialer: '中转', group: '中转' } }), /回环/);
  assert.throws(() => tpl.editStatics(base, { dialers: { '落地 A': '不存在' } }), /不存在/);
});

console.log(`\n全部通过 (${n})`);
