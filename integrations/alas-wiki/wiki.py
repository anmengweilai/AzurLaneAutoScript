#!/usr/bin/env python3
"""碧蓝航线 Wiki 本地镜像与查询工具。

把 wiki.biligame.com/blhx 的舰船页 / 装备页抓成本地 Markdown，并提供检索用的 CLI。
只用标准库，不装依赖。

    python3 wiki.py fetch catalog            # 刷新舰船 / 装备清单
    python3 wiki.py fetch ships [--limit N]  # 增量抓舰船页
    python3 wiki.py fetch equipment
    python3 wiki.py fetch page 企业          # 单独抓一页
    python3 wiki.py list ships [--limit N]
    python3 wiki.py search 独角兽 [--type ships]
    python3 wiki.py show 企业 [--section 配装推荐]
    python3 wiki.py sections 企业
    python3 wiki.py stats
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://wiki.biligame.com/blhx/api.php"
BASE = "https://wiki.biligame.com/blhx/"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REFERER = BASE + urllib.parse.quote("首页")

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CATALOG = DATA / "catalog.json"
META = DATA / "meta.json"

CATEGORIES = {"ships": "舰娘", "equipment": "装备"}


# --------------------------------------------------------------------------- http

def api_call(params: dict, retries: int = 3, delay: float = 2.0) -> dict:
    """带反爬头的 API 调用。站点用 567 挡异常流量，退避重试。"""
    url = API + "?" + urllib.parse.urlencode({"format": "json", **params})
    last = None
    for attempt in range(retries):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Referer": REFERER,
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
            return json.loads(body)
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}"
            if error.code in (429, 567, 503):
                time.sleep(delay * (attempt + 2))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last = str(error)
            time.sleep(delay * (attempt + 1))
    raise RuntimeError(f"wiki API failed after {retries} tries: {last}")


def page_wikitext(title: str) -> str | None:
    data = api_call({"action": "parse", "page": title, "prop": "wikitext"})
    if "error" in data:
        return None
    return data.get("parse", {}).get("wikitext", {}).get("*")


def category_members(category: str, kind: str = "page") -> list[str]:
    titles: list[str] = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": f"Category:{category}",
        "cmlimit": "500",
        "cmtype": kind,
    }
    while True:
        data = api_call(params)
        for member in data.get("query", {}).get("categorymembers", []):
            titles.append(member["title"])
        cont = data.get("continue")
        if not cont or "cmcontinue" not in cont:
            break
        params["cmcontinue"] = cont["cmcontinue"]
        time.sleep(1.5)
    return titles


# ------------------------------------------------------------------------ clean

RE_COMMENT = re.compile(r"<!--.*?-->", re.S)
RE_FILE = re.compile(r"\[\[(?:文件|File|图像|Image):[^\]]*\]\]", re.I)
RE_CATEGORY = re.compile(r"\[\[(?:Category|分类):[^\]]*\]\]", re.I)
RE_LINK = re.compile(r"\[\[([^\]|]+)\|([^\]]+)\]\]")
RE_LINK_PLAIN = re.compile(r"\[\[([^\]]+)\]\]")
RE_TAG = re.compile(r"</?(?:div|span|center|font|small|big|p|br|hr|u|b|i|sup|sub|ruby|rt|rp|abbr|nowiki)\b[^>]*/?>", re.I)
RE_STYLE = re.compile(r"(?:style|class|align|width|height|colspan|rowspan|data-[a-z-]+)=\"[^\"]*\"")
RE_MAGIC = re.compile(r"__(?:TOC|NOTOC|NOEDITSECTION|INDEX|NEWSECTIONLINK)__")
RE_BLANK = re.compile(r"\n{3,}")


def clean(text: str) -> str:
    """把 wikitext 压成可读文本：保留模板与表格，去掉样式、文件、分类噪音。"""
    text = RE_COMMENT.sub("", text)
    text = RE_FILE.sub("", text)
    text = RE_CATEGORY.sub("", text)
    text = RE_MAGIC.sub("", text)
    text = RE_TAG.sub("", text)
    text = RE_STYLE.sub("", text)
    text = RE_LINK.sub(r"\2", text)
    text = RE_LINK_PLAIN.sub(r"\1", text)
    text = re.sub(r"\{\{\s*(?:面包屑|ResourceLoader)[^}]*\}\}", "", text)
    return RE_BLANK.sub("\n\n", text).strip()


# ----------------------------------------------------------------------- catalog

def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_catalog() -> dict:
    catalog = {"fetched_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    for key, category in CATEGORIES.items():
        titles = category_members(category)
        catalog[key] = titles
        print(f"{key}: {len(titles)} 条", file=sys.stderr)
        time.sleep(1.5)
    save_json(CATALOG, catalog)
    return catalog


# ------------------------------------------------------------------------- fetch

def data_dir(kind: str) -> Path:
    return DATA / kind


def page_paths(kind: str, title: str) -> tuple[Path, Path]:
    safe = re.sub(r'[\\/:*?"<>|]', "_", title)
    base = data_dir(kind)
    return base / f"{safe}.md", base / f"{safe}.wiki"


def write_page(kind: str, title: str, wikitext: str) -> int:
    md_path, wiki_path = page_paths(kind, title)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    wiki_path.write_text(wikitext, encoding="utf-8")
    header = f"# {title}\n\n> 来源：{BASE}{urllib.parse.quote(title)}\n> 抓取：{time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    md_path.write_text(header + clean(wikitext) + "\n", encoding="utf-8")
    return len(wikitext)


def fetch_kind(kind: str, limit: int | None, force: bool, delay: float) -> None:
    catalog = load_json(CATALOG, None)
    if not catalog or kind not in catalog:
        print("没有清单，先跑 `fetch catalog`", file=sys.stderr)
        sys.exit(2)

    titles = catalog[kind]
    if limit:
        titles = titles[:limit]

    done = 0
    skipped = 0
    failed: list[str] = []
    for index, title in enumerate(titles, 1):
        md_path, _ = page_paths(kind, title)
        if md_path.exists() and not force:
            skipped += 1
            continue
        try:
            text = page_wikitext(title)
        except RuntimeError as error:
            failed.append(f"{title}: {error}")
            print(f"[{index}/{len(titles)}] FAIL {title}", file=sys.stderr)
            time.sleep(delay * 3)
            continue
        if text is None:
            failed.append(f"{title}: page missing")
            continue
        size = write_page(kind, title, text)
        done += 1
        if index % 20 == 0 or index == len(titles):
            print(f"[{index}/{len(titles)}] {title} ({size} chars) done={done} skip={skipped}", file=sys.stderr)
        time.sleep(delay)

    meta = load_json(META, {})
    meta[kind] = {
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pages": {
            "total": len(catalog[kind]),
            "written": done,
            "skipped": skipped,
            "failed": failed,
        },
    }
    save_json(META, meta)
    print(f"完成：新增 {done}，跳过 {skipped}，失败 {len(failed)}", file=sys.stderr)


def fetch_one(title: str, kind: str = "ships", delay: float = 2.0) -> None:
    text = page_wikitext(title)
    if text is None:
        print(f"页面不存在：{title}", file=sys.stderr)
        sys.exit(1)
    size = write_page(kind, title, text)
    print(f"{title} -> {page_paths(kind, title)[0]} ({size} chars)")


# ------------------------------------------------------------------------- query

def list_pages(kind: str, limit: int | None, pattern: str | None) -> None:
    base = data_dir(kind)
    if not base.exists():
        print(f"还没有 {kind} 数据，先跑 `fetch {kind}`", file=sys.stderr)
        sys.exit(2)
    files = sorted(base.glob("*.md"))
    if pattern:
        files = [f for f in files if re.search(pattern, f.stem)]
    if limit:
        files = files[:limit]
    for file in files:
        print(file.stem)
    print(f"# {len(files)} 个", file=sys.stderr)


def search(keyword: str, kind: str | None, limit: int) -> None:
    kinds = [kind] if kind else ["ships", "equipment"]
    pattern = re.compile(keyword, re.I)
    hits = 0
    for each in kinds:
        base = data_dir(each)
        if not base.exists():
            continue
        for file in sorted(base.glob("*.md")):
            text = file.read_text(encoding="utf-8", errors="replace")
            if not pattern.search(text):
                continue
            line = ""
            for candidate in text.splitlines():
                if pattern.search(candidate):
                    line = candidate.strip()
                    break
            print(f"[{each}] {file.stem}: {line[:120]}")
            hits += 1
            if hits >= limit:
                print(f"# 命中 {hits}（已达上限）", file=sys.stderr)
                return
    print(f"# 命中 {hits}", file=sys.stderr)


def find_page(title: str) -> Path:
    for kind in ("ships", "equipment"):
        md_path, _ = page_paths(kind, title)
        if md_path.exists():
            return md_path
        base = data_dir(kind)
        if base.exists():
            for file in base.glob("*.md"):
                if file.stem == title:
                    return file
    raise SystemExit(f"本地没有这一页：{title}（先 `fetch page {title}` 或 `search` 找准确标题）")


def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = "（开头）"
    buffer: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^==+\s*(.+?)\s*==+$", line)
        if match:
            sections[current] = "\n".join(buffer).strip()
            current = match.group(1)
            buffer = []
        else:
            buffer.append(line)
    sections[current] = "\n".join(buffer).strip()
    return sections


def show(title: str, section: str | None, raw: bool) -> None:
    path = find_page(title)
    text = path.read_text(encoding="utf-8", errors="replace")
    if section:
        sections = split_sections(text)
        match = next((name for name in sections if section in name), None)
        if not match:
            print(f"没有这个章节。可用：{', '.join(list(sections)[:20])}", file=sys.stderr)
            sys.exit(1)
        print(sections[match])
        return
    if raw:
        print(text)
        return
    print(text)


def show_sections(title: str) -> None:
    path = find_page(title)
    for name in split_sections(path.read_text(encoding="utf-8", errors="replace")):
        print(name)


def stats() -> None:
    catalog = load_json(CATALOG, {})
    meta = load_json(META, {})
    print(f"清单抓取：{catalog.get('fetched_at', '—')}")
    for kind in ("ships", "equipment"):
        base = data_dir(kind)
        count = len(list(base.glob("*.md"))) if base.exists() else 0
        total = len(catalog.get(kind, []))
        info = meta.get(kind, {}).get("pages", {})
        print(f"{kind}: 本地 {count} / 清单 {total}，上次新增 {info.get('written', 0)}，失败 {len(info.get('failed', []))}")
    size = sum(f.stat().st_size for f in DATA.rglob("*") if f.is_file()) if DATA.exists() else 0
    print(f"数据目录：{DATA}（{size / 1024 / 1024:.1f} MB）")
    for kind, info in meta.items():
        for failure in info.get("pages", {}).get("failed", [])[:5]:
            print(f"  失败：{failure}")


# --------------------------------------------------------------------------- cli

def main() -> None:
    parser = argparse.ArgumentParser(description="碧蓝航线 Wiki 本地镜像工具")
    sub = parser.add_subparsers(dest="command", required=True)

    fetch = sub.add_parser("fetch", help="抓取数据")
    fetch.add_argument("target", choices=["catalog", "ships", "equipment", "page"])
    fetch.add_argument("title", nargs="?", help="fetch page 时给页面名")
    fetch.add_argument("--limit", type=int)
    fetch.add_argument("--force", action="store_true", help="已有文件也重抓")
    fetch.add_argument("--delay", type=float, default=1.6, help="请求间隔秒，默认 1.6")

    listing = sub.add_parser("list", help="列出本地页面")
    listing.add_argument("kind", nargs="?", default="ships", choices=["ships", "equipment"])
    listing.add_argument("--limit", type=int)
    listing.add_argument("--grep")

    find = sub.add_parser("search", help="全文搜索")
    find.add_argument("keyword")
    find.add_argument("--type", choices=["ships", "equipment"])
    find.add_argument("--limit", type=int, default=20)

    view = sub.add_parser("show", help="看某一页或某一章")
    view.add_argument("title")
    view.add_argument("--section")
    view.add_argument("--raw", action="store_true")

    sections = sub.add_parser("sections", help="列出章节")
    sections.add_argument("title")

    sub.add_parser("stats", help="镜像概况")

    args = parser.parse_args()

    if args.command == "fetch":
        if args.target == "catalog":
            fetch_catalog()
        elif args.target == "page":
            if not args.title:
                parser.error("fetch page 需要一个页面名")
            fetch_one(args.title, delay=args.delay)
        else:
            fetch_kind(args.target, args.limit, args.force, args.delay)
    elif args.command == "list":
        list_pages(args.kind, args.limit, args.grep)
    elif args.command == "search":
        search(args.keyword, args.type, args.limit)
    elif args.command == "show":
        show(args.title, args.section, args.raw)
    elif args.command == "sections":
        show_sections(args.title)
    elif args.command == "stats":
        stats()


if __name__ == "__main__":
    main()