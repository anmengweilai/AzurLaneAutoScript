#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/equipment/*.wiki 里首个「图鉴模板」解析成结构化数据表。

用法：
    python3 scripts/extract_equipment.py

输入：data/equipment/*.wiki（只读，绝不修改原始文件）
输出：
    data/derived/equipment.csv   UTF-8 BOM，表头 = 名称,模板,等级,类型 + 实际出现的字段并集
    data/derived/equipment.md    总览（模板/类型计数、字段填充率）+ 按类型分组的表格

只用标准库。
"""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # integrations/alas-wiki
SRC_DIR = ROOT / "data" / "equipment"
OUT_DIR = ROOT / "data" / "derived"
OUT_CSV = OUT_DIR / "equipment.csv"
OUT_MD = OUT_DIR / "equipment.md"

FIXED_COLS = ["名称", "模板", "等级", "类型"]
PAGE_NAME_RE = re.compile(r"T(\d+)\s*$", re.IGNORECASE)
# 预扫描用：页面里第一个模板的名字（可能被 {{DISPLAYTITLE:...}} / {{JS|...}} 占位）
RAW_TPL_RE = re.compile(r"^\{\{(\S+?图鉴|\S+?)")
SKIP_TEMPLATES = ("DISPLAYTITLE", "DEFAULTSORT", "JS")


# --------------------------------------------------------------------------
# wikitext 解析
# --------------------------------------------------------------------------
def _clean(value: str) -> str:
    """折叠换行/空白，保证一个字段值能放进 CSV / md 单元格。"""
    return re.sub(r"\s+", " ", value).strip()


def _match_block(text: str, start: int) -> int:
    """start 指向 '{{'，返回与之配对的 '}}' 之后的索引；未闭合返回 -1。"""
    depth = 0
    i = start
    n = len(text)
    while i < n - 1:
        pair = text[i : i + 2]
        if pair == "{{":
            depth += 1
            i += 2
            continue
        if pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
            continue
        i += 1
    return -1


def _split_top(inner: str) -> list[str]:
    """按顶层 '|' 切分模板内部文本；'{{...}}' 与 '[[...]]' 里的 '|' 不算分隔符。"""
    parts: list[str] = []
    buf: list[str] = []
    depth_tpl = 0
    depth_link = 0
    i = 0
    n = len(inner)
    while i < n:
        pair = inner[i : i + 2]
        if pair == "{{":
            depth_tpl += 1
            buf.append(pair)
            i += 2
            continue
        if pair == "}}":
            depth_tpl = max(0, depth_tpl - 1)
            buf.append(pair)
            i += 2
            continue
        if pair == "[[":
            depth_link += 1
            buf.append(pair)
            i += 2
            continue
        if pair == "]]":
            depth_link = max(0, depth_link - 1)
            buf.append(pair)
            i += 2
            continue
        ch = inner[i]
        if ch == "|" and depth_tpl == 0 and depth_link == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def _template_name(inner: str) -> str:
    return _split_top(inner)[0].strip()


def find_main_template(text: str) -> tuple[str, str] | tuple[None, None]:
    """返回 (模板名, 模板内部文本)。

    页面开头可能先出现 {{DISPLAYTITLE:...}} 或 {{JS|...}} 之类的装饰模板，
    因此遍历所有顶层模板块，优先取第一个名字以「图鉴」结尾的。
    """
    blocks: list[tuple[str, str]] = []
    i = 0
    while True:
        start = text.find("{{", i)
        if start < 0:
            break
        end = _match_block(text, start)
        if end < 0:  # 剩余部分括号不平衡，放弃
            break
        inner = text[start + 2 : end - 2]
        name = _template_name(inner)
        if name.endswith("图鉴"):
            return name, inner
        blocks.append((name, inner))
        i = end

    for name, inner in blocks:
        if not name.upper().startswith(SKIP_TEMPLATES):
            return name, inner
    return None, None


def parse_template(inner: str) -> tuple[str, "OrderedDict[str, str]"]:
    """拆出模板名与参数。无 '=' 的位置参数记为 _posN。"""
    parts = _split_top(inner)
    name = parts[0].strip()
    fields: "OrderedDict[str, str]" = OrderedDict()
    pos = 0
    for raw in parts[1:]:
        if not raw.strip():
            continue
        key, sep, value = raw.partition("=")
        if not sep:
            pos += 1
            fields[f"_pos{pos}"] = _clean(raw)
            continue
        key = _clean(key)
        if not key:
            continue
        fields[key] = _clean(value)
    return name, fields


def load_page(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    tpl_name, inner = find_main_template(text)
    stem = path.stem
    if not tpl_name:
        return {
            "名称": stem,
            "模板": "",
            "等级": level_of(stem),
            "类型": "",
            "_file": path.name,
            "_parse_error": "未找到模板块",
        }
    _, fields = parse_template(inner)
    row: dict = {}
    row["名称"] = fields.get("名称") or stem
    row["模板"] = tpl_name
    row["等级"] = level_of(row["名称"]) or level_of(stem)
    row["类型"] = fields.get("类型", "")
    for key, value in fields.items():
        if key in ("名称", "类型") or key.startswith("_pos"):
            continue
        row[key] = value
    row["_file"] = path.name
    return row


def level_of(name: str) -> str:
    m = PAGE_NAME_RE.search(name or "")
    return f"T{m.group(1)}" if m else ""


def prescan_templates(paths: list[Path]) -> Counter:
    """按约定正则预扫描页面首个模板名，用来确认要处理的模板集合。"""
    counter: Counter = Counter()
    for path in paths:
        head = path.read_text(encoding="utf-8", errors="replace")[:2000]
        m = RAW_TPL_RE.match(head)
        counter[m.group(1) if m else "(首模板非图鉴/无法匹配)"] += 1
    return counter


# --------------------------------------------------------------------------
# 输出：CSV
# --------------------------------------------------------------------------
def build_columns(rows: list[dict]) -> list[str]:
    counter = Counter()
    first_seen: dict[str, int] = {}
    for idx, row in enumerate(rows):
        for key in row:
            if key.startswith("_"):
                continue
            counter[key] += 1
            first_seen.setdefault(key, idx)
    # 排序：常用字段在前；强化+N 这类派生字段统一沉到末尾，让核心属性保持连续可读
    rest = [k for k in counter if k not in FIXED_COLS]
    rest.sort(key=lambda k: (k.startswith("强化+"), -counter[k], first_seen[k]))
    return FIXED_COLS + rest


def write_csv(rows: list[dict], columns: list[str]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(columns)
        for row in rows:
            writer.writerow([row.get(col, "") for col in columns])


# --------------------------------------------------------------------------
# 输出：Markdown
# --------------------------------------------------------------------------
LINK_RE = re.compile(r"\[\[([^\[\]|]*)\|([^\[\]|]*)\]\]")
LINK_PLAIN_RE = re.compile(r"\[\[([^\[\]|]*)\]\]")
TAG_RE = re.compile(r"<[^>]{1,80}>")
TEMPLATE_FLAT_RE = re.compile(r"\{\{[^{}]*\}\}")


def md_text(value: str, limit: int = 70) -> str:
    text = value or ""
    for _ in range(3):
        new = TEMPLATE_FLAT_RE.sub(lambda m: m.group(0)[2:-2].split("|")[-1], text)
        if new == text:
            break
        text = new
    text = LINK_RE.sub(lambda m: m.group(2), text)
    text = LINK_PLAIN_RE.sub(lambda m: m.group(1), text)
    text = TAG_RE.sub("", text)
    text = _clean(text).replace("|", "\\|")
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


def md_table(columns: list[str], rows: list[dict]) -> list[str]:
    lines = ["| " + " | ".join(columns) + " |", "|" + "|".join(["---"] * len(columns)) + "|"]
    for row in rows:
        cells = []
        for col in columns:
            cell = md_text(row.get(col, ""), 50 if col not in ("名称", "等级", "类型") else 40)
            cells.append(cell)
        lines.append("| " + " | ".join(cells) + " |")
    return lines


def write_md(rows: list[dict], columns: list[str]) -> None:
    total = len(rows)
    tpl_counter = Counter(row["模板"] or "(未识别)" for row in rows)
    level_counter = Counter(row["等级"] or "(无)" for row in rows)
    type_by_tpl: dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        type_by_tpl[row["模板"] or "(未识别)"][row["类型"] or "(未标注)"] += 1
    fill = Counter()
    for row in rows:
        for col in columns:
            if row.get(col, "") != "":
                fill[col] += 1

    out: list[str] = []
    out.append("# 碧蓝航线装备结构化数据总览")
    out.append("")
    out.append(f"- 来源：`data/equipment/*.wiki`（{total} 个页面，只读）")
    out.append(f"- 产出：`data/derived/equipment.csv`（{total} 行 × {len(columns)} 列）、本文件")
    out.append(f"- 生成脚本：`scripts/extract_equipment.py`（仅标准库）")
    out.append("")
    out.append("## 1. 模板分布")
    out.append("")
    out.append("| 模板 | 数量 | 占比 |")
    out.append("|---|---|---|")
    for name, count in tpl_counter.most_common():
        out.append(f"| {name} | {count} | {count / total:.1%} |")
    out.append("")
    out.append("## 2. 等级分布")
    out.append("")
    out.append("| 等级 | 数量 |")
    out.append("|---|---|")
    for name, count in sorted(level_counter.items()):
        out.append(f"| {name} | {count} |")
    out.append("")
    out.append("## 3. 类型分布（按模板）")
    out.append("")
    for tpl in [n for n, _ in tpl_counter.most_common()]:
        out.append(f"### {tpl}")
        out.append("")
        out.append("| 类型 | 数量 |")
        out.append("|---|---|")
        for name, count in type_by_tpl[tpl].most_common():
            out.append(f"| {name} | {count} |")
        out.append("")

    out.append("## 4. 字段填充率")
    out.append("")
    missing = sorted(columns, key=lambda c: (fill[c], columns.index(c)))
    out.append("填充率最低的 5 个字段：")
    out.append("")
    for col in missing[:5]:
        out.append(f"- `{col}`：{fill[col]}/{total}（{fill[col] / total:.1%}）")
    out.append("")
    out.append("| 字段 | 非空数 | 填充率 |")
    out.append("|---|---|---|")
    for col in sorted(columns, key=lambda c: (-fill[c], columns.index(c))):
        out.append(f"| {col} | {fill[col]} | {fill[col] / total:.1%} |")
    out.append("")

    out.append("## 5. 按类型分组的明细")
    out.append("")
    for tpl in [n for n, _ in tpl_counter.most_common()]:
        out.append(f"### {tpl}")
        out.append("")
        for typ, _ in type_by_tpl[tpl].most_common():
            group = [r for r in rows if (r["模板"] or "(未识别)") == tpl and (r["类型"] or "(未标注)") == typ]
            if not group:
                continue
            # 组内表格列：名称/等级 + 组内填充率 >= 50% 的字段（最多 8 个，保持字段并集顺序）
            cols = ["名称", "等级"]
            extra = []
            for col in columns:
                if col in FIXED_COLS:
                    continue
                non_empty = sum(1 for r in group if r.get(col, ""))
                if non_empty >= max(1, int(len(group) * 0.5)):
                    extra.append((non_empty, col))
            extra.sort(key=lambda x: (-x[0], columns.index(x[1])))
            cols.extend(col for _, col in extra[:8])
            out.append(f"#### {tpl} · {typ}（{len(group)}）")
            out.append("")
            out.extend(md_table(cols, group))
            out.append("")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(out) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main() -> int:
    files = sorted(SRC_DIR.glob("*.wiki"))
    if not files:
        print(f"[x] 没找到输入文件：{SRC_DIR}", file=sys.stderr)
        return 1

    rows: list[dict] = []
    template_scan = Counter()
    errors: list[str] = []

    raw_scan = prescan_templates(files)
    skip_raw = sum(cnt for name, cnt in raw_scan.items() if not name.endswith("图鉴"))
    print("=" * 66)
    print(f"预扫描（首个模板块名）: {dict(raw_scan.most_common())}")
    if skip_raw:
        print(f"  其中 {skip_raw} 页首块是 DISPLAYTITLE/JS 等装饰模板，已向后寻找首个 *图鉴 模板")

    for path in files:
        try:
            row = load_page(path)
        except Exception as exc:  # 单页出错不拖垮整批
            errors.append(f"{path.name}: {exc!r}")
            row = {
                "名称": path.stem,
                "模板": "",
                "等级": level_of(path.stem),
                "类型": "",
                "_file": path.name,
            }
        rows.append(row)
        template_scan[row["模板"] or "(未识别)"] += 1

    columns = build_columns(rows)
    write_csv(rows, columns)
    write_md(rows, columns)

    empty_names = [r["_file"] for r in rows if not r.get("名称")]
    no_level = [r["_file"] for r in rows if not r.get("等级")]
    no_type = [r["_file"] for r in rows if not r.get("类型")]

    print("=" * 66)
    print(f"输入页面      : {len(files)}")
    print(f"解析行数      : {len(rows)}")
    print(f"字段并集列数  : {len(columns)}")
    print(f"模板分布      : {dict(template_scan.most_common())}")
    print(f"等级缺失      : {len(no_level)}")
    print(f"类型缺失      : {len(no_type)}")
    print(f"名称缺失      : {len(empty_names)}")
    print(f"异常          : {len(errors)}")
    for item in errors[:10]:
        print("   ", item)
    fill = {col: sum(1 for r in rows if r.get(col, "")) for col in columns}
    low = sorted(columns, key=lambda c: fill[c])[:5]
    print("填充率最低字段:")
    for col in low:
        print(f"    {col}: {fill[col]}/{len(rows)} = {fill[col] / len(rows):.1%}")
    print(f"CSV           : {OUT_CSV}")
    print(f"MD            : {OUT_MD}")
    print("=" * 66)

    ok = True
    if len(rows) != len(files):
        print("[x] 行数与文件数不一致", file=sys.stderr)
        ok = False
    if empty_names:
        print(f"[x] 名称列存在空值：{empty_names[:5]}", file=sys.stderr)
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())