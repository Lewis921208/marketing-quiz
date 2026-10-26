#!/usr/bin/env python3
"""
解析 Obsidian 行銷管理期中考考古題與課本答案 Markdown 檔，輸出 data/questions.json 並複製圖片至 assets/。
預設只輸出 4 題最高頻 demo 題（1-1、2-1、3-1、5-1）；加上 --all 輸出全部 24 題。
"""

import argparse
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path

from study_guides import STUDY_GUIDES

DEMO_IDS = ["1-1", "2-1", "3-1", "5-1"]

DEFAULT_VAULT_DIR = Path(
    "/Users/zhanxunxiang/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obisidian"
)
DEFAULT_MD_PATH = (
    DEFAULT_VAULT_DIR / "0 Inbox" / "行銷管理期中考 考古題與課本答案（Ch1–Ch5）.md"
)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_PATH = PROJECT_ROOT / "data" / "questions.json"
DEFAULT_ASSETS_DIR = PROJECT_ROOT / "assets"


def normalize_text(text: str) -> str:
    """
    與前端 JS normalizeText 完全一致的正規化邏輯（僅比對文字段落，忽略表格與公式）：
    1. 去掉 Obsidian 圖片嵌入 ![[...]] 與 LaTeX 公式區塊 $$...$$
    2. 去掉 Markdown 表格列（| ... |）、圖說行（*圖：...*）與 Obsidian [!note] 區塊
    3. Unicode NFKC（全形轉半形，如 （1）-> (1)、Ａ -> A）
    4. 去掉行首列表編號（1.、a. 等）與行內括號編號 (1)、(2) 等
    5. 去掉所有 Markdown 符號、空白與標點，只保留中文字與英數字元
    """
    if not text:
        return ""

    # 1. 移除 Obsidian 圖片語法 ![[...]] 與 LaTeX 區塊 $$...$$
    s = re.sub(r"!\[\[.*?\]\]", "", text)
    s = re.sub(r"\$\$[\s\S]*?\$\$", "", s)

    # 2. 移除 Markdown 表格列、圖說行與 [!note] 補充註記行
    lines = []
    in_note_callout = False
    for raw_line in s.splitlines():
        stripped = raw_line.strip()
        if re.match(r"^>\s*\[!note\]", stripped, flags=re.IGNORECASE):
            in_note_callout = True
            continue
        if in_note_callout:
            if stripped.startswith(">"):
                continue
            in_note_callout = False
        if stripped.startswith("|") and stripped.endswith("|"):
            continue
        if re.match(r"^\*?\s*圖[：:].*$", stripped):
            continue
        lines.append(raw_line)
    s = "\n".join(lines)

    # 3. NFKC 全形 -> 半形
    s = unicodedata.normalize("NFKC", s)

    # 4. 移除行首列表編號（例如 "1. "、"- a. "、"  2. "）與行內 "(1)" 編號
    s = re.sub(
        r"(?m)^\s*(?:[-*>]+\s*)*(?:\d+\.|[a-zA-Z]\.)\s+",
        "",
        s,
    )
    s = re.sub(r"\(\d+\)", "", s)

    # 5. 只保留中文字（基本漢字與擴展 A）及英數字元
    s = re.sub(r"[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+", "", s)
    return s


def clean_display_answer(raw_answer: str) -> str:
    """
    清理顯示用的 answer_raw：
    移除 ![[...]]、*圖：...* 圖說行、以及 > [!note] 編輯備註，保留其餘原文排版與表格。
    """
    lines = []
    in_note_callout = False
    for line in raw_answer.splitlines():
        stripped = line.strip()
        if re.match(r"^!\[\[.*?\]\]$", stripped):
            continue
        if re.match(r"^\*?\s*圖[：:].*$", stripped):
            continue
        if re.match(r"^>\s*\[!note\]", stripped, flags=re.IGNORECASE):
            in_note_callout = True
            continue
        if in_note_callout:
            if stripped.startswith(">"):
                continue
            in_note_callout = False
        lines.append(line)

    cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def find_image_in_vault(vault_dir: Path, filename: str) -> Path | None:
    """在 Obsidian vault 中尋找圖片檔案。"""
    direct = vault_dir / "_Meta" / "Attachments" / filename
    if direct.is_file():
        return direct
    for root, _, files in os.walk(vault_dir):
        if filename in files:
            return Path(root) / filename
    return None


def parse_prompt_line(line: str) -> dict:
    """解析單條歷屆題目，分離出年份與題幹。"""
    content = re.sub(r"^-\s*", "", line.strip())
    m = re.match(r"^(\d{2,3}-\d+|\d{2,3}\s*專班)\s+(.+)$", content)
    if m:
        return {
            "year": m.group(1).strip(),
            "text": m.group(2).strip(),
            "raw": content,
        }
    return {
        "year": "",
        "text": content,
        "raw": content,
    }


def parse_markdown(
    md_path: Path,
    vault_dir: Path,
    assets_dir: Path,
    include_all: bool = False,
) -> list[dict]:
    text = md_path.read_text(encoding="utf-8")

    chapter_code = ""
    chapter_title = ""
    questions = []

    lines = text.splitlines()
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        ch_match = re.match(r"^##\s+(Ch\d+)\s*(.*)$", line.strip())
        if ch_match:
            chapter_code = ch_match.group(1).strip()
            rest = ch_match.group(2).strip()
            chapter_title = f"{chapter_code} {rest}".strip() if rest else chapter_code
            i += 1
            continue

        topic_match = re.match(r"^###\s+(\d+-\d+)\s+(.+)$", line.strip())
        if topic_match:
            q_id = topic_match.group(1).strip()
            q_title = topic_match.group(2).strip()
            i += 1

            block_lines = []
            while i < n and not re.match(r"^##?#?\s+", lines[i].strip()):
                block_lines.append(lines[i])
                i += 1

            block_text = "\n".join(block_lines)
            prompts_section = ""
            answer_section = ""

            sec_splits = re.split(r"(?m)^####\s+", block_text)
            for sec in sec_splits:
                sec = sec.strip()
                if not sec:
                    continue
                first_nl = sec.find("\n")
                if first_nl == -1:
                    sec_header, sec_body = sec, ""
                else:
                    sec_header, sec_body = sec[:first_nl].strip(), sec[first_nl + 1 :].strip()

                if "歷屆題目" in sec_header:
                    prompts_section = sec_body
                elif "課本答案" in sec_header:
                    answer_section = sec_body

            answer_section = re.sub(r"(?m)^\s*---\s*$", "", answer_section).strip()

            prompts = []
            for p_line in prompts_section.splitlines():
                if p_line.strip().startswith("-"):
                    prompts.append(parse_prompt_line(p_line))

            raw_images = re.findall(r"!\[\[(.*?)\]\]", answer_section)
            copied_images = []
            for img_name in raw_images:
                img_name = img_name.strip()
                src_path = find_image_in_vault(vault_dir, img_name)
                if src_path and src_path.is_file():
                    assets_dir.mkdir(parents=True, exist_ok=True)
                    dst_path = assets_dir / img_name
                    shutil.copy2(src_path, dst_path)
                    copied_images.append(f"assets/{img_name}")

            answer_raw = clean_display_answer(answer_section)
            answer_norm = normalize_text(answer_raw)
            has_table = bool(re.search(r"(?m)^\s*\|.*\|\s*$", answer_raw))
            has_diagram = len(copied_images) > 0
            has_formula = "$$" in answer_raw

            questions.append(
                {
                    "id": q_id,
                    "chapter": chapter_code,
                    "chapter_title": chapter_title,
                    "title": q_title,
                    "prompts": prompts,
                    "answer_raw": answer_raw,
                    "answer_norm": answer_norm,
                    "images": copied_images,
                    "has_table": has_table,
                    "has_diagram": has_diagram,
                    "has_formula": has_formula,
                    "study_guide": STUDY_GUIDES.get(q_id, {}),
                }
            )
            continue

        i += 1

    if not include_all:
        questions = [q for q in questions if q["id"] in DEMO_IDS]

    return questions


def main() -> None:
    parser = argparse.ArgumentParser(description="解析行銷管理考古題與課本答案 Markdown")
    parser.add_argument(
        "--all",
        action="store_true",
        help="輸出全部 24 題（預設只輸出 4 題 demo：1-1、2-1、3-1、5-1）",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_MD_PATH,
        help="輸入 Obsidian Markdown 路徑",
    )
    parser.add_argument(
        "--vault",
        type=Path,
        default=DEFAULT_VAULT_DIR,
        help="Obsidian Vault 根目錄（用於尋找圖片）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUT_PATH,
        help="輸出 JSON 路徑",
    )
    parser.add_argument(
        "--assets",
        type=Path,
        default=DEFAULT_ASSETS_DIR,
        help="圖片輸出資料夾",
    )
    args = parser.parse_args()

    questions = parse_markdown(
        md_path=args.input,
        vault_dir=args.vault,
        assets_dir=args.assets,
        include_all=args.all,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    json_str = json.dumps(questions, ensure_ascii=False, indent=2)
    args.output.write_text(json_str + "\n", encoding="utf-8")

    # 同步更新 index.html 內的 #questions-fallback，讓 file:// 直接雙擊開啟也能載入題庫
    index_html_path = PROJECT_ROOT / "index.html"
    if index_html_path.is_file():
        html_text = index_html_path.read_text(encoding="utf-8")
        compact_json = json.dumps(questions, ensure_ascii=False).replace("</script>", "<\\/script>")
        new_html, count = re.subn(
            r'(<script id="questions-fallback" type="application/json">)[\s\S]*?(</script>)',
            lambda m: f"{m.group(1)}{compact_json}{m.group(2)}",
            html_text,
        )
        if count > 0:
            index_html_path.write_text(new_html, encoding="utf-8")

    mode_label = "全題庫 (--all)" if args.all else "Demo 4 題"
    total_images = sum(len(q["images"]) for q in questions)
    print(f"[{mode_label}] 已輸出 {len(questions)} 題至 {args.output}（複製 {total_images} 張圖片）")


if __name__ == "__main__":
    main()
