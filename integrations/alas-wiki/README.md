# alas-wiki

把 [碧蓝航线 WIKI](https://wiki.biligame.com/blhx/) 的舰船页、装备页抓成本地 Markdown，并提供一个检索用的 CLI。
负责「游戏知识」——alas 配置负责「执行」，两边配合用。

纯标准库，不用装依赖。

## 快速开始

```bash
cd integrations/alas-wiki

python3 wiki.py fetch catalog        # 刷新清单（舰船 697 / 装备 898）
python3 wiki.py fetch ships          # 增量抓全部舰船，已抓过的跳过
python3 wiki.py fetch equipment      # 增量抓全部装备
python3 wiki.py stats                # 看进度
```

首次全量大约 45 分钟（697 + 898 页 × 1.5 秒间隔）。中途断掉直接重跑，已下载的会跳过。

## 查询

```bash
python3 wiki.py list ships                       # 列出本地舰船
python3 wiki.py list ships --grep 皇家            # 按文件名过滤
python3 wiki.py search 独角兽                    # 全文搜索（默认只给命中行）
python3 wiki.py search 穿甲 --type equipment     # 只搜装备
python3 wiki.py sections 企业                    # 看有哪些章节
python3 wiki.py show 企业                        # 看整页
python3 wiki.py show 企业 --section 配装推荐      # 只看一章
python3 wiki.py show 企业 --raw                  # 连 front matter 一起
python3 wiki.py fetch page 信浓                  # 单独抓/刷新一页
```

输出走 stdout，进度和统计走 stderr，可以直接管道给 grep / head。

## 数据怎么存

```
data/
  catalog.json          清单：ships[] / equipment[]，来自 Category:舰娘 / Category:装备
  meta.json             每次抓取的统计和失败项
  ships/<标题>.md       清洗后的正文（去掉样式、文件、分类噪音，保留模板与表格）
  ships/<标题>.wiki     原始 wikitext（要重新加工时用这个）
  equipment/<标题>.md
```

舰船页的结构化信息（编号 / 稀有度 / 阵营 / 建造耗时 / 属性）大多在 `{{舰娘图鉴 ...}}` 模板参数里，
`.wiki` 那份是原样，`grep -A20 '{{舰娘图鉴' data/ships/企业.wiki` 最好使。

## 数据来源

- 舰船：`Category:舰娘` 的全部条目（697）
- 装备：`Category:装备` 的全部条目（898）
- 单页：MediaWiki `action=parse&prop=wikitext`

`Category:活动` 是空的，活动攻略不在此列——要查现搜：
`python3 wiki.py fetch page <攻略页名>`，页名先用
`curl "https://wiki.biligame.com/blhx/api.php?action=query&list=search&srsearch=活动攻略&format=json"` 找。

## 反爬

站点用 **HTTP 567** 挡异常流量。本工具已经带了：

- 浏览器 UA + Referer（缺了直接 567）
- 默认 1.5 秒请求间隔（`--delay` 可调）
- 567 / 429 / 503 自动退避重试 3 次

别把 `--delay` 调到 1 秒以下，也别和别的爬虫同时跑。真被封了换 `browser-agent` skill 用真浏览器取页面。

## 已知取舍

- **只抓 wikitext**，不渲染 HTML：模板算出来的最终数值（比如装备的实际属性加成）拿不到，拿到的是模板参数。要看渲染结果用浏览器。
- **正文是清洗过的 wikitext**，不是完美 Markdown：`{{模板}}`、`{| 表格 |}` 原样保留，可读但不算排版漂亮。
- **活动攻略不预抓**：时效性强，页面名每年变，按需查更省事。
- 数据是玩家维护的，内容准确度取决于编辑者；关键结论对照游戏内实测。

## 和 skill 的关系

`integrations/alas-mcp/SKILL.md` 里的「WIKI 查询与分析」一节讲的是**在线查**（curl API）。
本地镜像建好之后，优先走本地：`search` → `show`，省一次网络往返，也不会被反爬影响。
本地没命中再去在线搜。