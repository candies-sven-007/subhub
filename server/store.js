'use strict';
// 极简 JSON 文件存储:data/db.json,原子写入
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

const empty = () => ({ version: 1, subs: [], collections: [], templates: [], settings: {} });
const store = { db: empty(), DATA_DIR, CACHE_DIR };

store.load = function () {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    store.db = Object.assign(empty(), raw);
  }
  if (!store.db.settings.secret) {
    store.db.settings.secret = crypto.randomBytes(32).toString('hex');
    store.save();
  }
};

store.save = function () {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store.db, null, 2));
  fs.renameSync(tmp, FILE);
};

store.id = () => crypto.randomBytes(6).toString('hex');
store.token = () => crypto.randomBytes(18).toString('base64url');

store.readCache = function (id) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, id + '.json'), 'utf8')); } catch { return null; }
};
store.writeCache = function (id, data) {
  try { fs.writeFileSync(path.join(CACHE_DIR, id + '.json'), JSON.stringify(data)); } catch { /* 缓存失败不影响主流程 */ }
};
store.dropCache = function (id) {
  try { fs.unlinkSync(path.join(CACHE_DIR, id + '.json')); } catch { /* ignore */ }
};

module.exports = store;
