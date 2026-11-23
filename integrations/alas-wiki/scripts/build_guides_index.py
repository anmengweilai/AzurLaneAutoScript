#!/usr/bin/env python3
"""把 data/ 下的活动/攻略/图鉴类页面整理成一份可检索的目录索引。

输入：data/<分类>/<标题>.md（清洗后正文，首行是 `# 标题`，随后是 `> 来源`）
输出：data/derived/guides.csv（UTF-8 BOM）与 data/derived/guides.md

只读 data/ 下的原始页面，不改任何 .md / .wiki；只用标准库。

用法：
    python3 scripts/build_guides_index.py            # 生成 + 自检
    python3 scripts/build_guides_index.py --summary-len 100
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys

# 目录顺序 = 输出顺序（活动在最前，装备/兵装在后）
CATEGORIES = [
    "活动攻略",
    "活动关卡图鉴汇总",
    "关卡图鉴汇总",
    "可打捞",
    "原型舰相关",
    "专属特殊兵装",
    "设备",
]

# 类型信号：前 8 个是任务点名要的，后 4 个是同类页面里高频、检索时有用的扩展信号
SIGNAL_RULES = [
    ("活动", re.compile(r"活动")),
    ("复刻", re.compile(r"复刻")),
    ("常驻", re.compile(r"常驻")),
    ("打捞", re.compile(r"打捞")),
    ("主线", re.compile(r"主线")),
    ("EX", re.compile(r"EX\d|(?<![A-Za-z])EX(?![A-Za-z0-9])")),
    ("SP", re.compile(r"SP\d|(?<![A-Za-z])SP(?![A-Za-z0-9])")),
    ("T0", re.compile(r"T0(?!\d)")),
    ("掉落", re.compile(r"掉落")),
    ("建造", re.compile(r"建造")),
    ("改造", re.compile(r"改造")),
    ("兑换", re.compile(r"兑换")),
]

# 这些模板里放的是正文用的短词（舰名/道具名），删模板时保留参数文字
KEEP_INLINE = {"小图标", "图标", "彩色字", "colored", "ColoredText", "舰娘", "皮肤", "换装", "角色"}

# 摘要兜底：模板里真正像「一句话介绍」的字段，按优先级取第一个非空
DESC_FIELDS = [
    "技能描述",
    "兵装效果描述",
    "技能强化描述",
    "兵装效果",
    "描述",
    "简介",
    "介绍",
    "说明",
    "备注",
    "text",      # {{InfoBox|text=...}} 里通常是页面导语
]

CJK = re.compile(r"[\u4e00-\u9fff]")
# 样式表/代码残渣，不是正文段落
JUNK = re.compile(r"[{}]|/\*|\*/|display\s*:|px;|\bmw-")
SUMMARY_LEN = 120

# 页名里的日期：2018年1月19日09_00港区改建 / 2019年BILIBILI电量支援计划活动专题
RE_NAME_FULL = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
RE_NAME_ISO = re.compile(r"(20\d{2})[-./](\d{1,2})[-./](\d{1,2})")
RE_NAME_YM = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月")
RE_NAME_Y = re.compile(r"(20\d{2})\s*年")
RE_NAME_D8 = re.compile(r"(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)")


# --------------------------------------------------------------------------- #
# wikitext 清洗
# --------------------------------------------------------------------------- #

def drop_templates(text: str) -> str:
    """删掉所有成对的 {{...}}（支持嵌套）；落单的也删到行尾。

    图标类模板里装的是舰名/道具名（`{{小图标|伏波}}`），删了会留下「由、、装备时」，
    所以这类保留第一个位置参数的文字。
    """
    out = []
    i, n = 0, len(text)
    while i < n:
        j = text.find("{{", i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        depth, k = 0, j
        while k < n - 1:
            if text.startswith("{{", k):
                depth += 1
                k += 2
            elif text.startswith("}}", k):
                depth -= 1
                k += 2
                if depth == 0:
                    break
            else:
                k += 1
        if depth != 0:  # 没闭合，整段丢掉
            break
        body = text[j + 2 : k - 2]
        if template_name(body) in KEEP_INLINE:
            pos = [q.strip() for q in body.split("|")[1:] if "=" not in q]
            if pos and pos[0] and len(pos[0]) <= 20 and not re.search(r"[{}\[\]]", pos[0]):
                out.append(pos[0])
        i = k
    return "".join(out)


def strip_markup(text: str) -> str:
    """把一行 wikitext 洗成可读纯文本。"""
    t = text
    t = re.sub(r"<ref[^>]*>.*?</ref>", "", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]{1,60}>", "", t)
    t = re.sub(r"\[\[(?:文件|File|Image|图像|分类|Category)[^\]]*\]\]", "", t, flags=re.I)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)   # [[a|b]] -> b
    t = re.sub(r"\[(?:https?|ftp)://\S+\s+([^\]]*)\]", r"\1", t)  # [url 文本] -> 文本
    t = drop_templates(t)
    t = t.replace("'''", "").replace("''", "")
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">")):
        t = t.replace(a, b)
    t = re.sub(r"__[A-Za-z]+__", "", t)      # __notoc__ / __TOC__ 大小写都有
    t = re.sub(r"([、，。；：])\1+", r"\1", t)
    t = re.sub(r"[ \t\u3000\u00a0]+", " ", t)
    # 行内用 >…< 当装饰标题的，把两头的尖括号去掉；顺手去掉开头的顿号/逗号残渣
    return t.strip(" \t\u3000>＜<＞").lstrip("、，。；：,.;:")


def iter_templates(text: str):
    """按出现顺序吐出顶层模板的 body（不含外层花括号）。"""
    i, n = 0, len(text)
    while i < n:
        j = text.find("{{", i)
        if j < 0:
            return
        depth, k = 0, j
        while k < n - 1:
            if text.startswith("{{", k):
                depth += 1
                k += 2
            elif text.startswith("}}", k):
                depth -= 1
                k += 2
                if depth == 0:
                    break
            else:
                k += 1
        if depth != 0:
            return
        yield text[j + 2 : k - 2]
        i = k


def template_name(body: str) -> str:
    head = body.split("\n", 1)[0]
    return head.split("|", 1)[0].strip()


def template_fields(text: str):
    """收集模板参数：字段名 -> 第一个非空值；同时返回模板名列表。"""
    fields, names = {}, []
    for body in iter_templates(text):
        name = template_name(body)
        if name:
            names.append(name)
        for line in body.splitlines():
            m = re.match(r"^\s*\|\s*([^=|]+?)\s*=\s*(.*)$", line)
            if not m:
                continue
            key, val = m.group(1).strip(), m.group(2).strip()
            if key and val:
                fields.setdefault(key, val)
    return fields, names


# --------------------------------------------------------------------------- #
# 摘要
# --------------------------------------------------------------------------- #

def first_paragraph(lines) -> str:
    """跳过模板 / 表格 / 标题 / 列表 / 引用，取第一段有中文的正文。"""
    i, n = 0, len(lines)
    if i < n and lines[i].lstrip().startswith("#"):
        i += 1
    while i < n:  # 跳过 `> 来源` `> 抓取` 与空行
        s = lines[i].strip()
        if not s or s.startswith(">"):
            i += 1
        else:
            break

    depth = 0
    while i < n:
        ln = lines[i]
        s = ln.strip()
        if depth > 0:                                   # 模板内部，继续吞
            depth = max(0, depth + ln.count("{{") - ln.count("}}"))
            i += 1
            continue
        if s.startswith("{{"):
            depth = max(0, ln.count("{{") - ln.count("}}"))
            i += 1
            continue
        if s.startswith("{|"):                          # 表格
            while i < n and not lines[i].strip().startswith("|}"):
                i += 1
            i += 1
            continue
        low = s.lower()
        if low.startswith(("<gallery", "<pre", "<poem", "<math", "<timeline",
                           "<syntaxhighlight", "bstyle", "<bstyle", "<style", "<templatestyles")):
            tag = re.match(r"<?([a-z]+)", low).group(1)
            while i < n and ("</%s>" % tag) not in lines[i].lower() and \
                    not (tag == "bstyle" and lines[i].strip() == "</bstyle>"):
                i += 1
            i += 1
            continue
        if ("{" in s or "}" in s) and not CJK.search(s):  # 裸 CSS
            i += 1
            continue
        if (not s or s.startswith(("|", "=", "----", ">"))
                or re.match(r"^[*#:;]", s) or re.match(r"^</?[A-Za-z]", s)):
            i += 1
            continue

        buf = []                                        # 一段正文：连续的非结构行
        while i < n:
            s2 = lines[i].strip()
            if (not s2 or s2.startswith(("{{", "{|", "|", "=", "----", ">"))
                    or re.match(r"^[*#:;]", s2) or re.match(r"^</?[A-Za-z]", s2)):
                break
            buf.append(s2)
            i += 1
        txt = strip_markup(" ".join(buf))
        if len(CJK.findall(txt)) >= 3 and len(txt) >= 8 and not JUNK.search(txt):
            return txt
    return ""


def clip(text: str, limit: int = SUMMARY_LEN) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def compose_from_fields(fields, names, title: str) -> str:
    """没有正文段落时，用模板字段拼一句可读摘要。"""
    if "关卡标题" in fields or "关卡编号" in fields:
        head = fields.get("关卡标题") or title
        txt = f"关卡「{head}」"
        # 活动页用 关卡编号，作战档案页拆成 普通关卡编号 / 困难关卡编号
        if fields.get("关卡编号"):
            txt += f" {strip_markup(fields['关卡编号'])}"
        else:
            if fields.get("普通关卡编号"):
                txt += f" 普通 {strip_markup(fields['普通关卡编号'])}"
            if fields.get("困难关卡编号"):
                txt += f"；困难 {strip_markup(fields['困难关卡编号'])}"
        if fields.get("活动主页面"):
            txt += f"；所属活动：{strip_markup(fields['活动主页面'])}"
        return txt

    pairs = []
    for key, label in (
        ("稀有度", "稀有度"),
        ("类型", "类型"),
        ("属性", "属性"),
        ("特性", "特性"),
        ("适用舰种", "适用"),
        ("专属角色", "专属"),
        ("阵营", "阵营"),
        ("技能名", "技能"),
        ("掉落点", "掉落"),
    ):
        val = strip_markup(fields.get(key, ""))
        if val and len(val) <= 40:
            pairs.append(f"{label}：{val}")
    if pairs:
        return "｜".join(pairs[:4])

    # 最后兜底：模板名 + 前几个像样的字段
    extra = []
    for key, val in fields.items():
        if key in ("名称", "排序编号", "唯一装备", "禁用舰种"):
            continue
        v = strip_markup(val)
        if v and 2 <= len(v) <= 40 and CJK.search(v):
            extra.append(f"{key}：{v}")
        if len(extra) >= 3:
            break
    if extra:
        return "｜".join(extra)
    return ""


def build_summary(text: str, title: str):
    """返回 (摘要, 来源, 为空的原因)。来源：正文首段 / 模板描述 / 模板字段 / 空。"""
    lines = text.splitlines()
    para = first_paragraph(lines)
    if para:
        return clip(para), "正文首段", ""

    fields, names = template_fields(text)
    for key in DESC_FIELDS:
        val = strip_markup(fields.get(key, ""))
        if len(CJK.findall(val)) >= 3 and len(val) >= 8:
            return clip(val), "模板描述", ""

    val = compose_from_fields(fields, names, title)
    if len(CJK.findall(val)) >= 3:
        return clip(val), "模板字段", ""

    tpl = "、".join(dict.fromkeys(names)) or "无模板"
    return "", "空", f"正文无自然段，模板（{tpl}）也没有可读描述字段"


# --------------------------------------------------------------------------- #
# 日期
# --------------------------------------------------------------------------- #

def valid(y, m, d):
    return 2000 <= int(y) <= 2035 and 1 <= int(m) <= 12 and 1 <= int(d) <= 31


def date_from_name(stem: str) -> str:
    m = RE_NAME_FULL.search(stem)
    if m and valid(*m.groups()):
        return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    m = RE_NAME_ISO.search(stem)
    if m and valid(*m.groups()):
        return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    m = RE_NAME_D8.search(stem)
    if m and valid(*m.groups()):
        return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    m = RE_NAME_YM.search(stem)
    if m and valid(int(m.group(1)), int(m.group(2)), 1):
        return "%04d-%02d" % (int(m.group(1)), int(m.group(2)))
    m = RE_NAME_Y.search(stem)
    if m and 2000 <= int(m.group(1)) <= 2035:
        return m.group(1)
    return ""


def date_from_template(fields) -> str:
    """关卡页的 排序编号=20170828 其实就是活动日期（yyyymmdd）。"""
    raw = strip_markup(fields.get("排序编号", ""))
    m = re.fullmatch(r"(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])", raw)
    if m and valid(*m.groups()):
        return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    for key in ("日期", "上线时间", "开放时间"):
        m = RE_NAME_FULL.search(strip_markup(fields.get(key, "")))
        if m and valid(*m.groups()):
            return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    return ""


# --------------------------------------------------------------------------- #
# 单页处理
# --------------------------------------------------------------------------- #

def read_page(path: str) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    return raw.decode("utf-8-sig", errors="replace")


def process(category: str, filename: str, data_dir: str) -> dict:
    path = os.path.join(data_dir, category, filename)
    stem = filename[: -len(".md")]
    text = read_page(path)
    date = date_from_name(stem)
    date_src = "页名" if date else ""
    if not date:
        fields, _ = template_fields(text)
        date = date_from_template(fields)
        if date:
            date_src = "模板排序编号"

    summary, summary_src, empty_reason = build_summary(text, stem)
    keywords = [label for label, pat in SIGNAL_RULES if pat.search(stem) or pat.search(text)]

    return {
        "分类": category,
        "标题": stem,
        "日期": date,
        "关键词": "、".join(keywords),
        "摘要": summary,
        "字节数": os.path.getsize(path),
        "_date_src": date_src,
        "_summary_src": summary_src,
        "_empty_reason": empty_reason,
        "_has_wiki": os.path.exists(os.path.join(data_dir, category, stem + ".wiki")),
        "_h1": (text.splitlines()[0][2:].strip() if text.startswith("# ") else ""),
        "_keywords": keywords,
    }


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #

CSV_COLUMNS = ["分类", "标题", "日期", "关键词", "摘要", "字节数"]


def write_csv(rows, path: str) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        w.writerow(CSV_COLUMNS)
        for r in rows:
            w.writerow([r[c] for c in CSV_COLUMNS])


def cell(text: str) -> str:
    return text.replace("|", "｜").replace("\n", " ").strip()


def pct(a: int, b: int) -> str:
    return f"{a / b * 100:.1f}%" if b else "0.0%"


def write_md(rows, path: str, meta: dict) -> None:
    total = len(rows)
    dated = sum(1 for r in rows if r["日期"])
    with_summary = sum(1 for r in rows if r["摘要"])
    out = []
    out.append("# 碧蓝航线活动 / 攻略 / 图鉴目录索引")
    out.append("")
    out.append(f"由 `scripts/build_guides_index.py` 扫描 `data/` 下 {len(CATEGORIES)} 个分类、"
               f"{total} 个 `.md` 页面生成；机器可读版本见同目录 `guides.csv`。")
    out.append("")
    out.append("摘要取自正文第一段自然段（跳过模板、表格），没有自然段的页面退回模板描述字段，"
               "统一截断到 120 字。日期优先从页名解析，页名没有日期时用关卡模板的 `排序编号`（yyyymmdd）。")
    out.append("")

    # ---- 总览 ----
    out.append("## 总览")
    out.append("")
    out.append("| 分类 | 页数 | 含日期 | 日期覆盖率 | 摘要非空 | 摘要非空率 | 平均字节 |")
    out.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for cat in CATEGORIES:
        sub = [r for r in rows if r["分类"] == cat]
        d = sum(1 for r in sub if r["日期"])
        s = sum(1 for r in sub if r["摘要"])
        avg = sum(r["字节数"] for r in sub) // len(sub) if sub else 0
        out.append(f"| {cat} | {len(sub)} | {d} | {pct(d, len(sub))} | {s} | {pct(s, len(sub))} | {avg} |")
    out.append(f"| **合计** | **{total}** | **{dated}** | **{pct(dated, total)}** | "
               f"**{with_summary}** | **{pct(with_summary, total)}** | "
               f"**{sum(r['字节数'] for r in rows) // total if total else 0}** |")
    out.append("")
    out.append(f"- 全部 {total} 页里 {meta['has_wiki']} 页有对应 `.wiki` 原文；"
               f"跨目录同名页 {meta['dup']} 个。")
    if meta["no_summary"]:
        out.append(f"- 摘要为空的 {len(meta['no_summary'])} 页见文末「未解析出摘要的页面」。")
    out.append("")

    # ---- 信号分布 ----
    out.append("## 类型信号命中分布")
    out.append("")
    out.append("| 信号 | 命中页数 | 占比 |")
    out.append("| --- | ---: | ---: |")
    for label, _ in SIGNAL_RULES:
        c = sum(1 for r in rows if label in r["_keywords"])
        out.append(f"| {label} | {c} | {pct(c, total)} |")
    out.append("")

    # ---- 分类明细 ----
    for cat in CATEGORIES:
        sub = [r for r in rows if r["分类"] == cat]
        if not sub:
            continue
        d = sum(1 for r in sub if r["日期"])
        s = sum(1 for r in sub if r["摘要"])
        out.append(f"## {cat}（{len(sub)} 页，{d} 页含日期，{s} 页有摘要）")
        out.append("")
        out.append("| 标题 | 日期 | 关键词 | 摘要 |")
        out.append("| --- | --- | --- | --- |")
        for r in sub:
            out.append(f"| {cell(r['标题'])} | {r['日期'] or '—'} | {cell(r['关键词']) or '—'} | "
                       f"{cell(r['摘要']) or '—'} |")
        out.append("")

    # ---- 空摘要附录 ----
    if meta["no_summary"]:
        out.append("## 未解析出摘要的页面")
        out.append("")
        out.append("| 分类 | 标题 | 原因 |")
        out.append("| --- | --- | --- |")
        for r in meta["no_summary"]:
            out.append(f"| {r['分类']} | {cell(r['标题'])} | {cell(r['_empty_reason'])} |")
        out.append("")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out).rstrip() + "\n")


# --------------------------------------------------------------------------- #
# 自检与报告
# --------------------------------------------------------------------------- #

def self_check(rows, md_files: int) -> bool:
    total = len(rows)
    with_summary = sum(1 for r in rows if r["摘要"])
    ok_rows = abs(total - md_files) <= 2
    ok_sum = total > 0 and with_summary / total > 0.80

    print("自检：")
    print(f"  CSV 数据行 {total} / 目录内 .md {md_files}（允许 ±2）  -> {'PASS' if ok_rows else 'FAIL'}")
    print(f"  摘要非空 {with_summary}/{total} = {with_summary / total * 100:.1f}%（要求 > 80%）"
          f"  -> {'PASS' if ok_sum else 'FAIL'}")

    empty = [r for r in rows if not r["摘要"]]
    if empty:
        print(f"  摘要为空 {len(empty)} 页：")
        for r in empty:
            print(f"    - {r['分类']}/{r['标题']}：{r['_empty_reason']}")
    else:
        print("  摘要为空 0 页。")
    return ok_rows and ok_sum


def report(rows) -> None:
    total = len(rows)
    print()
    print("按分类：")
    for cat in CATEGORIES:
        sub = [r for r in rows if r["分类"] == cat]
        d = sum(1 for r in sub if r["日期"])
        s = sum(1 for r in sub if r["摘要"])
        avg = sum(r["字节数"] for r in sub) // len(sub) if sub else 0
        print(f"  {cat:<10} {len(sub):>4} 页  含日期 {d:>3} ({pct(d, len(sub)):>5})  "
              f"摘要 {s:>4} ({pct(s, len(sub)):>5})  平均 {avg} 字节")

    print()
    print("摘要来源：")
    for src in ("正文首段", "模板描述", "模板字段", "空"):
        c = sum(1 for r in rows if r["_summary_src"] == src)
        print(f"  {src}：{c}")

    print()
    print("日期来源：")
    dated = [r for r in rows if r["日期"]]
    for src in ("页名", "模板排序编号"):
        c = sum(1 for r in dated if r["_date_src"] == src)
        print(f"  {src}：{c}")
    no_date = total - len(dated)
    print(f"  无日期：{no_date}（覆盖率 {pct(len(dated), total)}）")

    print()
    print("信号命中：")
    for label, _ in SIGNAL_RULES:
        c = sum(1 for r in rows if label in r["_keywords"])
        print(f"  {label:<4} {c:>4} 页 ({pct(c, total)})")
    dist = {}
    for r in rows:
        dist[len(r["_keywords"])] = dist.get(len(r["_keywords"]), 0) + 1
    print("  每页信号数分布：" + "，".join(f"{k}个={v}" for k, v in sorted(dist.items())))

    print()
    print("命名/结构检查：")
    h1diff = [r for r in rows if r["_h1"] and r["_h1"] != r["标题"]]
    print(f"  首行标题与文件名不一致：{len(h1diff)} 页")
    for r in h1diff:
        print(f"    - {r['分类']}/{r['标题']}  ->  {r['_h1']}")
    nowiki = [r for r in rows if not r["_has_wiki"]]
    print(f"  缺 .wiki 原文：{len(nowiki)} 页")
    for r in nowiki[:10]:
        print(f"    - {r['分类']}/{r['标题']}")

    nan = [r for r in rows if not re.search(r"[\u4e00-\u9fff]", r["标题"])]
    print(f"  标题不含中文：{len(nan)} 页")
    if nan:
        print("    e.g. " + "、".join(r["标题"] for r in nan[:8]))

    for cat in CATEGORIES:
        sub = [r for r in rows if r["分类"] == cat]
        if not sub:
            continue
        sizes = sorted(r["字节数"] for r in sub)
        print(f"  {cat} 字节数：min={sizes[0]} 中位={sizes[len(sizes) // 2]} max={sizes[-1]}")


def main(argv=None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="生成活动/攻略/图鉴目录索引")
    ap.add_argument("--data-dir", default=os.path.join(root, "data"))
    ap.add_argument("--out-dir", default=os.path.join(root, "data", "derived"))
    args = ap.parse_args(argv)

    data_dir = os.path.abspath(args.data_dir)
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    rows, md_files, missing = [], 0, []
    for cat in CATEGORIES:
        cdir = os.path.join(data_dir, cat)
        if not os.path.isdir(cdir):
            missing.append(cat)
            continue
        names = sorted(f for f in os.listdir(cdir) if f.endswith(".md"))
        md_files += len(names)
        for fn in names:
            rows.append(process(cat, fn, data_dir))
    if missing:
        print(f"[warn] 目录不存在，已跳过：{'、'.join(missing)}", file=sys.stderr)

    order = {c: i for i, c in enumerate(CATEGORIES)}
    rows.sort(key=lambda r: (order[r["分类"]], r["标题"]))

    dup = {}
    for r in rows:
        dup.setdefault(r["标题"], set()).add(r["分类"])
    dup_n = sum(1 for v in dup.values() if len(v) > 1)
    meta = {
        "has_wiki": sum(1 for r in rows if r["_has_wiki"]),
        "dup": dup_n,
        "no_summary": [r for r in rows if not r["摘要"]],
    }

    csv_path = os.path.join(out_dir, "guides.csv")
    md_path = os.path.join(out_dir, "guides.md")
    write_csv(rows, csv_path)
    write_md(rows, md_path, meta)

    print(f"已写出 {csv_path}（{len(rows)} 行）")
    print(f"已写出 {md_path}")
    report(rows)
    print()
    return 0 if self_check(rows, md_files) else 1


if __name__ == "__main__":
    sys.exit(main())