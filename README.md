# SubHub

自托管的订阅管理与转换平台。前端 + 后端同一个服务、同一个域名,液态玻璃风格界面。
思路参考 Sub-Store,代码为独立从零实现。

## 功能(v0.2.0)

- **订阅**:远程链接(可多条合并)或本地粘贴;自动识别 Clash/Mihomo YAML、Base64、URI 列表
- **协议**:VLESS(含 Reality)、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、AnyTLS
- **组合**:多个订阅合并成一条地址
- **节点操作**:保留/排除(正则)、按协议过滤、正则改名、前后缀、排序、去重、设置属性
- **YAML 模板**:上传一份完整配置 → 自动抽掉节点,保留策略组/规则/DNS → 之后任何订阅都能套用
- **链式代理**:模板可保留自建的固定落地节点,通过 `dialer-proxy` 走「中转」组;中转组由订阅节点填充
- **输出**:Mihomo/Clash YAML(可套模板)、通用 Base64、JSON;按客户端 UA 自动识别
- 流量信息透传(subscription-userinfo)、上游失败时回退到上次缓存、备份/恢复、深浅色

## 部署(Docker)

```bash
git clone <你的仓库地址> subhub && cd subhub
# 编辑 docker-compose.yml,把 ADMIN_PASSWORD 改成强密码
docker compose up -d --build
```

服务监听 `127.0.0.1:8787`。在 Nginx Proxy Manager 里新建 Proxy Host,
转发到 `http://<宿主机IP>:8787` 并开启 SSL 即可(一个域名,前后端都在里面)。
若 NPM 也在 Docker 里,把 compose 里的端口改成 `8787:8787` 或让两者加入同一网络。

不用 Docker:`npm ci && ADMIN_PASSWORD=xxx node server/index.js`(需要 Node 20+)。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 自动生成并打印到日志 | 管理密码 |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录(db.json + 缓存) |
| `CACHE_TTL` | `300` | 远程订阅缓存秒数 |
| `TRUST_PROXY` | 关 | 设为 `1` 时信任 `X-Forwarded-For` |

## 订阅地址

```
https://你的域名/s/<token>                      按默认设置输出
https://你的域名/s/<token>?target=mihomo        mihomo | uri | json
https://你的域名/s/<token>?target=mihomo&tpl=模板名或ID   (tpl=none 表示不套模板)
```

token 即凭证,泄露后在「获取链接 → 重置地址」里换新。

## 模板是怎么工作的

上传 YAML 后,SubHub 会:

1. 删除 `proxies` 与 `proxy-providers`,其余键原样保留(注释会丢失)
2. 逐个分析 `proxy-groups`,为每个组生成「填充规则」:
   - 原来包含全部节点 / 用了 `include-all` / `use` → **放入全部节点**
   - 原来只含某地区节点(如"香港"组)→ 自动推断出**正则筛选**
   - 推断不出规律 → 暂放全部节点并标记**待确认**
   - 原来只引用其它组或 DIRECT/REJECT → **不放节点**
3. 套用时把新订阅的节点按规则填回各组;筛选后为空的组兜底放 `DIRECT`,避免内核报错

### 固定节点与链式代理

如果上传的配置里,策略组用 `use` 引用 proxy-providers,或节点带 `dialer-proxy`,
自带的 `proxies` 会被当作**固定节点**保留在模板里(上传时也可手动选择保留/移除):

- 固定节点原样保留,包括 `dialer-proxy: 中转` 这样的链式设置
- 原来 `use` 订阅的组(如「中转」)改为由导入的订阅节点填充,于是「订阅节点 → 落地节点」的链路自动成立
- 在模板编辑页可以改每个固定节点的前置组、删除,或粘贴 URI 追加新的落地节点
- 订阅节点与固定节点/策略组重名时会自动加序号;把落地节点设进含它自身的组会被拒绝(防回环)
- YAML 锚点与 `<<:` 合并写法会被展开

规则可在「模板 → 编辑填充规则」里逐组修改,正则支持 mihomo 的 `(?i)` 前缀写法。

## 与 Sub-Store 相比暂未实现

- Surge / Loon / Quantumult X / sing-box 输出格式
- 脚本操作(运行自定义 JS)、国旗/地区自动标注、域名解析
- Gist 同步、文件管理、定时任务

## 开发

```bash
npm ci
npm test          # 解析器 / 节点操作 / 模板引擎自测
npm start
```

## 更新日志

- **0.2.0** 模板支持固定节点与链式代理(dialer-proxy);支持 YAML 锚点合并;订阅节点与模板内名称冲突时自动改名
- **0.1.0** 首个版本
