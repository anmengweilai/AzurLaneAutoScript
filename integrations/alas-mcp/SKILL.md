---
name: alas-control
description: 操作碧蓝航线 Alas 面板（实例启停、读写配置、日志、更新），并会查碧蓝航线 Wiki 分析舰船/装备/活动/大世界。触发：agent 要启动/停止/重启 alas 实例、改 alas 配置（如 Scheduler/Emulator 里的开关）、翻 alas 日志、查实例状态或调度计划、跑更新；以及要查某条船强不强、某装备给谁、某活动怎么打、大世界怎么配队、读 wiki.biligame.com/blhx 页面。
---

# alas-control：用 MCP 操作 Alas

> 面板：`http://127.0.0.1:22267`，新界面在 `/app/`，旧 PyWebIO 界面在 `/`
> 工具：`mcp__alas__alas_instances` / `alas_config` / `alas_logs` / `alas_system`
> 服务端代码：`integrations/alas-mcp/`（本仓库），工具实现在 `src/tools.js`

先确认工具在不在。调用列表里没有 `mcp__alas__*` 就说明 MCP 没挂上，别硬试别的路：
去设置页看 MCP 那一行状态，或读 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 `mcp-alas` 条目。

## 四个工具

| 工具 | action | 对应网页 |
|---|---|---|
| `alas_instances` | `list` `get` `start` `stop` `restart` `overview` `create` `templates` | 「实例」页 + 实例详情的启停按钮 |
| `alas_config` | `get` `patch` `validate` `export` `schema` `menu` `i18n` | 实例详情里的配置表单、批量动态页的「管理配置文件」 |
| `alas_logs` | —（参数 `name` / `limit` / `cursor` / `wait_ms`） | 实例详情的 Log 面板 |
| `alas_system` | `health` `version` `runtime` `bootstrap` `settings` `update_settings` `update_status` `update_check` `update_run` `update_cancel` `remote_access` | 「主页」「更新器」「远程控制」「工具」页 |

## 状态模型

`running`（调度器在跑）· `stopped` · `starting`（3 秒内）· `stopping` · `failed`（启动后立刻死了）· `updating` · `unknown`

判断实例是不是活着看 `state`，不要看 `pid` 是否为 null——`stopping` 阶段 pid 还在。

## 标准配方

**看全部实例**
```json
{"action": "list"}
```
返回每条的 `name` / `mod` / `state` / `pid` / `log_cursor`。

**启动**（可选指定任务）
```json
{"action": "start", "name": "alas"}
{"action": "start", "name": "alas", "task": "Main"}
```
已经在跑就直接返回当前状态，不会重复拉起。

**停止 / 重启**
```json
{"action": "stop", "name": "alas"}
{"action": "restart", "name": "alas"}
```
停止会掐掉当前正在跑的任务。重启前先想清楚要不要中断。

**看调度计划**
```json
{"action": "overview", "name": "alas"}
```
返回 `running`（当前任务）/ `pending`（排队）/ `waiting`（等时间窗），每项带 `next_run` 和 `enabled`。日志看着「半天没动」时先看这个——很可能只是 Delay 到很晚，不是卡死。

**读日志**
```json
{"name": "alas", "limit": 60}
```
会先吐缓冲里最近的，再挂 `wait_ms`（默认 2000）听实时输出。续读用返回的 `cursor`：
```json
{"name": "alas", "cursor": 123, "limit": 60}
```
日志来自内存环形缓冲（最近 1000 条），服务重启就清空，历史日志去 `log/` 目录翻文件。

**改配置**（四步，别跳）
1. 找路径：`{"action": "schema"}` 拿全量 schema，或者 `{"action": "menu"}` 只看有哪些任务页
2. 先校验：`{"action": "validate", "name": "alas", "changes": [{"path": "Scheduler.ServerUpdate", "value": "cn"}]}`
3. 试保存：`{"action": "patch", "name": "alas", "changes": [...], "dry_run": true}`
4. 真写：去掉 `dry_run`

读配置别整份拉：
```json
{"action": "get", "name": "alas", "paths": ["Scheduler.ServerUpdate", "Alas.Emulator.PackageName"]}
```
不带 `paths` 会返回几千行 JSON，白烧上下文。

返回里的 `apply_hint` 决定要不要重启：
- `none` → 没变
- `next_start` → 实例是停的，下次启动生效
- `running_reload` → 实例在跑，改的值要等调度器重新加载才吃，必要时 `restart`

**检查更新**
```json
{"action": "update_check"}
{"action": "update_status"}
{"action": "update_run"}
```
都是异步，`update_run` 之后轮询 `update_status` 看进度，别连着发。

## 网页 ↔ 工具对照

| 网页上做的事 | 工具调用 |
|---|---|
| 实例页「刷新」 | `alas_instances` `list` |
| 实例页「启动 / 停止」 | `alas_instances` `start` / `stop` |
| 实例页「新建实例」 | `alas_instances` `create`（`name` + `copy_from`） |
| 实例详情顶部状态圈 | `alas_instances` `get` |
| 详情页 Scheduler / Pending / Waiting 三个区块 | `alas_instances` `overview` |
| 详情页 Log 面板 | `alas_logs` |
| 详情页配置表单（改了自动存） | `alas_config` `patch` |
| 管理配置文件页「导出」 | `alas_config` `export` |
| 管理配置文件页「删除 / 导入」 | 没有对应工具，走文件系统或让用户确认后手改 `config/` |
| 主页主题/语言 | `alas_system` `settings` / `update_settings` |
| 主页「强制重启」 | `alas_system` 里没有独立工具，用 `POST /api/v1/system/force-restart` |
| 更新器页 | `alas_system` `update_*` |
| 远程控制页 | `alas_system` `remote_access` |

工具没覆盖的两个动作（删除实例、force-restart）用 bash + curl 补，别自己造：
```bash
curl -s -X POST http://127.0.0.1:22267/api/v1/system/force-restart
```
面板设了密码时要带 `-H "Authorization: Bearer <密码>"`。

## 坑

- **不要直接改 `config/*.json`**。配置有内存副本和 `config_updater` 回调，手改文件会被下次保存覆盖。一律走 `alas_config` `patch`。
- **配置路径是点号分隔的**，如 `Scheduler.ServerUpdate`、`Alas.Emulator.PackageName`。写错路径会返回 `Unknown config path`，拿 `schema` 核对。
- **只读字段改不了**：schema 里 `display` 是 `readonly` / `hide` / `disabled` 的路径会被拒。
- **停实例 = 停任务**。别在打大世界或活动图时随手 stop。
- **一个实例一份配置**，`alas` 和 `alas2` 互不影响（同名任务不同进度）。
- **远程访问**：没设密码时 Control API 只接本机；跨机用时先设 `Password`，再配 `ALAS_PASSWORD`。
- **服务本身由 launchd 托管**（`com.alas.webui`），不要用 `nohup` 起第二份，端口 22267 会撞。重启服务：`launchctl kickstart -k gui/$(id -u)/com.alas.webui`。

## 排障顺序

1. `alas_system` `health` → 面板活着吗
2. `alas_instances` `list` → 实例什么状态
3. 状态 `failed` → `alas_logs` 捞尾部，多半是模拟器/ADB 没连上
4. `alas_instances` `get` 拿到 `pid`，再 `ps -p <pid>` 看进程真身
5. 日志「静默」→ `alas_instances` `overview` 看是不是 Delay 到很远的任务
6. 配置改完没反应 → 看返回的 `apply_hint`，`running_reload` 就重启实例

## 验证

改完配置或启停之后，别只看接口返回 200：
- 启停：`list` 里 `state` 变成 `running` / `stopped`，`pid` 有/无
- 配置：`alas_config` `get` + `paths` 读回那个字段，值和写进去的一致
- 调度：`overview` 里 `next_run` 符合预期
---

# 附：碧蓝航线 WIKI 查询与分析

> 站点：`https://wiki.biligame.com/blhx/`
> MediaWiki 1.37，有 `api.php`，但没有 `extracts` 扩展，也没有 Cargo。
> 作用：查舰船/装备/活动/大世界的**游戏知识**；alas 配置负责**执行**。两者配合才完整。
>
> **先查本地镜像**（`integrations/alas-wiki/`，舰船 697 / 装备 898 已落地）：
> ```bash
> cd integrations/alas-wiki
> python3 wiki.py search 独角兽            # 全文搜
> python3 wiki.py sections 企业            # 看章节
> python3 wiki.py show 企业 --section 配装推荐
> ```
> 本地没命中、或要看渲染后的数值，再走下面的在线 API。

## 什么时候查 wiki

- 用户问「这船/这装备能不能用」「这活动怎么打」「大世界怎么配队」
- 要改 alas 配置但不确定该配什么（活动图编号、大世界阵容、换装、科研倾向）
- 排查「任务跑了但收益不对」——可能是配置选错了图或阵容

## 访问方式

**首选 API**（省 token，可脚本化）。两个头必须带，否则返回 HTTP 567 的反爬页：

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
API="https://wiki.biligame.com/blhx/api.php"
REF="Referer: https://wiki.biligame.com/blhx/首页"
```

**常用动作**

搜关键词（不知道页面叫什么时先搜）：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=query&list=search&srsearch=活动攻略&srlimit=5&format=json"
```

找准确标题（自动补全，返回标题数组）：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=opensearch&search=企业&limit=5&format=json"
```

看页面有哪些章节（**先看目录再取内容**，别整页拉）：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=parse&page=企业&prop=sections&format=json"
```

取某一章节的 wikitext（比 HTML 小很多）：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=parse&page=企业&prop=wikitext&section=0&format=json"
```

取渲染后的 HTML（要看模板算出来的数值时用，体积大）：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=parse&page=企业&prop=text&format=json"
```

查页面存不存在：
```bash
curl -s -m 20 -A "$UA" -H "$REF" "$API?action=query&titles=企业&format=json"
```

**被 567 挡了就走真浏览器**：加载 `browser-agent` skill，`node ba.mjs goto "https://wiki.biligame.com/blhx/企业"` 再 `node ba.mjs text` 取正文。别用 wget/curl 硬刷，越刷封得越久。

## 页面地图

| 想查 | 页面 |
|---|---|
| 某条船 | 页面名就是船名：`企业`、`独角兽`、`信浓` |
| 全部舰船 | `舰船图鉴`、`全舰船筛选`（可筛选） |
| 装备 | `装备图鉴` |
| 活动攻略 | 搜「XX活动攻略」，如 `碧蓝海事局XX活动攻略` |
| 大世界组队 | `大世界组队思路略讲`、`大世界系统阵容记录（虽来）` |
| 大世界解密 | `大世界解密关合集` |

舰船页固定四块：**舰船信息**（属性/技能）、**配装推荐**、情人节礼物、舰船台词，后面才是大段剧情（剧情跟配队无关，别去读）。

## 分析套路

**「这条船强不强 / 该不该上」**
1. `parse&prop=sections` 确认页面存在
2. 取「舰船信息」看属性（耐久/炮击/航空/装填）和技能
3. 取「配装推荐」看主流标签（炮队/航空/驱逐/潜艇/辅助）
4. 结论落到 alas：如果要用它，配装和阵容体现在 `Main` / `Opsi` 相关配置里

**「这活动怎么打 / 刷哪张图」**
1. 搜「活动攻略」拿页面
2. 看推荐图和掉落
3. 落到 alas：`EventGeneral` / `Event` 里的活动图选择，配合 `Campaign` 的关卡

**「大世界怎么配」**
1. 读「大世界组队思路略讲」+「大世界系统阵容记录」
2. 落到 alas：`Opsi` 的舰队/侵蚀/深渊配置

**「这装备给谁」**
1. 搜装备名 → 看装备页的适用舰种
2. 反过来在候选船的「配装推荐」里确认出现在推荐表里
3. 落到 alas：换装配置

## 坑

- **567 反爬**：必须带 UA + Referer；连续请求间隔 ≥2 秒；被挡了换 browser-agent，别重试刷。
- **页面别整页拉**：企业页 wikitext 几百 KB，先 `sections` 再按 `section=N` 取。
- **wiki 是玩家维护的**：活动攻略常有「复刻」「往期」版本，看页面最后更新时间和活动名对不对得上。
- **译名**：wiki 用国服译名；alas 配置里可能用英文/日文标识，对照着改。
- **别把 wiki 原文贴回去**：提炼成结论，附页面 URL 做出处。
- **wiki 不替代实测**：配队建议在 wiki 上是参考，实际以 alas 跑出来的结果为准。

## 出处

引用时给完整页面链接，例如 `https://wiki.biligame.com/blhx/企业`，别只写「wiki 上说」。
