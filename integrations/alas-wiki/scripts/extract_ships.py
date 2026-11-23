#!/usr/bin/env python3
"""把 data/ships/*.wiki 里的 {{舰娘图鉴 ...}} 模板抽成结构化数据表。

只用标准库。解析要点：
  * 定位第一个 `{{舰娘图鉴`（部分页面前面还有 {{DISPLAYTITLE:...}} 之类前缀）；
  * 用花括号配对找到模板真正的结尾（值里可能嵌 {{强化值|...}}）；
  * 按「顶层」的 `|` 切参数，同样跳过嵌套的 {{...}} / [[...]]。

产出：
  data/derived/ships.csv  UTF-8 BOM，方便 Excel 直接打开
  data/derived/ships.md   总览统计 + 按舰种分组的表格

用法：python3 scripts/extract_ships.py
"""

from __future__ import annotations

import collections
import csv
import glob
import os
import sys

# ---------------------------------------------------------------- 常量

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "data", "ships")
OUT_DIR = os.path.join(ROOT, "data", "derived")

TEMPLATE_NAME = "舰娘图鉴"

# (输出列名, 模板里的键名)
COLUMNS = [
    ("编号", "编号"),
    ("名称", "名称"),
    ("类型", "类型"),
    ("阵营", "阵营"),
    ("稀有度", "稀有度"),
    ("星级", "初始星级"),
    ("建造耗时", "耗时"),
    ("英文名", "英文名"),
    ("日文名", "日文名"),
    ("型号", "型号"),
]
HEADER = [name for name, _ in COLUMNS]

EXPECTED_ROWS = 697
TOLERANCE = 5


# ---------------------------------------------------------------- 解析

def find_template(text: str, name: str = TEMPLATE_NAME) -> str | None:
    """返回第一个 {{name ...}} 的完整文本（含外层的 {{ }}），找不到返回 None。"""
    marker = "{{" + name
    start = text.find(marker)
    if start < 0:
        return None

    depth = 0
    i = start
    n = len(text)
    while i < n - 1:
        two = text[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start:i]
            continue
        i += 1
    return None  # 括号没配平


def split_top_level(body: str) -> list[str]:
    """按顶层的 `|` 切分模板正文（跳过嵌套的 {{...}} / [[...]]）。"""
    inner = body[2:-2]  # 去掉最外层的 {{ }}
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    n = len(inner)
    while i < n:
        two = inner[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            buf.append(two)
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            buf.append(two)
            i += 2
            continue
        ch = inner[i]
        if ch == "|" and depth == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def parse_params(body: str) -> dict[str, str]:
    """把模板正文切成 {参数名: 原始值}。键做 strip，值保持原样。"""
    params: dict[str, str] = {}
    for part in split_top_level(body)[1:]:  # parts[0] 是模板名
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        params[key.strip()] = value.strip()
    return params


def clean_value(value: str) -> str:
    """去掉 HTML 注释、折叠空白。原文里的其它标记一律保留。"""
    import re

    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = value.replace("\r", " ").replace("\n", " ")
    return " ".join(value.split())


def sort_key(ship: dict) -> tuple[int, int, str]:
    """按编号排序，纯数字优先；编号缺失/非数字的排到各分组末尾。"""
    raw = ship.get("编号", "")
    if raw.isdigit():
        return (0, int(raw), "")
    return (1, 0, raw)


# ---------------------------------------------------------------- 读取

def load_ships(src_dir: str) -> tuple[list[dict], list[dict]]:
    """读全部 .wiki，返回 (成功列表, 失败列表)。"""
    ships: list[dict] = []
    failures: list[dict] = []

    paths = sorted(glob.glob(os.path.join(src_dir, "*.wiki")))
    if not paths:
        raise SystemExit(f"没找到任何 .wiki 文件：{src_dir}")

    for path in paths:
        basename = os.path.basename(path)
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            failures.append({"file": basename, "reason": f"读取失败: {exc}"})
            continue

        body = find_template(text)
        if body is None:
            failures.append({"file": basename, "reason": "找不到 {{舰娘图鉴}} 模板或括号不配平"})
            continue

        try:
            params = parse_params(body)
        except Exception as exc:  # noqa: BLE001 - 单页异常不该中断整批
            failures.append({"file": basename, "reason": f"参数切分异常: {exc}"})
            continue

        record = {"_file": basename}
        for out_name, tpl_key in COLUMNS:
            record[out_name] = clean_value(params.get(tpl_key, ""))
        record["_params"] = params  # 留给统计用，不落盘

        if not record["名称"]:
            failures.append({
                "file": basename,
                "reason": "缺少「名称」",
                "编号": record["编号"],
            })
            continue

        ships.append(record)

    return ships, failures


# ---------------------------------------------------------------- 输出

def write_csv(ships: list[dict], path: str) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        for ship in sorted(ships, key=sort_key):
            writer.writerow([ship.get(col, "") for col in HEADER])


def md_cell(value: str) -> str:
    return (value or "").replace("|", "\\|")


def md_table(ships: list[dict]) -> list[str]:
    lines = [
        "| " + " | ".join(HEADER) + " |",
        "| " + " | ".join("---" for _ in HEADER) + " |",
    ]
    for ship in sorted(ships, key=sort_key):
        lines.append("| " + " | ".join(md_cell(ship.get(c, "")) for c in HEADER) + " |")
    return lines


def counter_table(counter: collections.Counter, total: int, label: str) -> list[str]:
    lines = [
        f"| {label} | 数量 | 占比 |",
        "| --- | ---: | ---: |",
    ]
    for name, count in counter.most_common():
        share = (count / total * 100) if total else 0
        display = name if name else "（空）"
        lines.append(f"| {md_cell(display)} | {count} | {share:.1f}% |")
    lines.append(f"| **合计** | **{total}** | **100.0%** |")
    return lines


def write_md(ships: list[dict], path: str) -> None:
    total = len(ships)
    by_type = collections.Counter(s["类型"] or "" for s in ships)
    by_faction = collections.Counter(s["阵营"] or "" for s in ships)
    by_rarity = collections.Counter(s["稀有度"] or "" for s in ships)

    out: list[str] = []
    out.append("# 碧蓝航线舰船数据表")
    out.append("")
    out.append(
        f"由 `data/ships/` 下 {total} 个 `.wiki` 页面中的 `{{{{舰娘图鉴}}}}` 模板自动提取，"
        "机器可读版本见同目录 `ships.csv`。"
    )
    out.append("")

    out.append("## 总览统计")
    out.append("")
    out.append("### 按舰种")
    out.append("")
    out.extend(counter_table(by_type, total, "类型"))
    out.append("")
    out.append("### 按阵营")
    out.append("")
    out.extend(counter_table(by_faction, total, "阵营"))
    out.append("")
    out.append("### 按稀有度")
    out.append("")
    out.extend(counter_table(by_rarity, total, "稀有度"))
    out.append("")

    out.append("## 按舰种分组")
    out.append("")
    # 舰种按数量降序；同数量按名称排序，保证输出稳定
    type_order = sorted(by_type, key=lambda t: (-by_type[t], t))
    for type_name in type_order:
        group = [s for s in ships if (s["类型"] or "") == type_name]
        title = type_name if type_name else "（未标注类型）"
        out.append(f"### {title}（{len(group)}）")
        out.append("")
        out.extend(md_table(group))
        out.append("")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out).rstrip() + "\n")


# ---------------------------------------------------------------- 自检

def self_check(ships: list[dict], failures: list[dict], params_all: list[dict]) -> bool:
    ok = True
    total = len(ships)

    print("=" * 60)
    print("自检")
    print("=" * 60)
    print(f"成功解析: {total} 页")
    print(f"失败/异常: {len(failures)} 页")
    if abs(total - EXPECTED_ROWS) > TOLERANCE:
        ok = False
        print(f"  ✗ 行数 {total} 偏离预期 {EXPECTED_ROWS}（容差 ±{TOLERANCE}）")
    else:
        print(f"  ✓ 行数在预期范围 {EXPECTED_ROWS}±{TOLERANCE}")

    empty_name = [s["_file"] for s in ships if not s["名称"]]
    if empty_name:
        ok = False
        print(f"  ✗ 名称为空: {len(empty_name)} -> {empty_name}")
    else:
        print("  ✓ 名称列无空值")

    if failures:
        print("  ! 有问题页面：")
        for item in failures:
            print(f"      - {item['file']}: {item['reason']}")

    # 各字段缺失率（基于成功解析的页面）
    print("\n各字段缺失率：")
    for col in HEADER:
        missing = sum(1 for s in ships if not s.get(col))
        rate = missing / total * 100 if total else 0
        print(f"  {col:<8} 缺失 {missing:>3} ({rate:5.1f}%)")

    dups = collections.Counter(s["名称"] for s in ships)
    dup_names = {k: v for k, v in dups.items() if v > 1}
    if dup_names:
        print(f"\n  ! 重名: {dup_names}")
    else:
        print("\n  ✓ 名称无重复")

    dup_ids = collections.Counter(s["编号"] for s in ships if s["编号"])
    dup_id_hits = {k: v for k, v in dup_ids.items() if v > 1}
    print(f"  {'!' if dup_id_hits else '✓'} 编号重复: {dup_id_hits or '无'}")

    return ok


def main() -> int:
    ships, failures = load_ships(SRC_DIR)

    os.makedirs(OUT_DIR, exist_ok=True)
    csv_path = os.path.join(OUT_DIR, "ships.csv")
    md_path = os.path.join(OUT_DIR, "ships.md")

    write_csv(ships, csv_path)
    write_md(ships, md_path)

    ok = self_check(ships, failures, [s["_params"] for s in ships])

    print("\n产出：")
    print(f"  {os.path.abspath(csv_path)}")
    print(f"  {os.path.abspath(md_path)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())