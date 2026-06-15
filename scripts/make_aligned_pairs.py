#!/usr/bin/env python3
"""
Audio + .docx スクリプトから split-editor 用の入力ファイルを生成。

Input:
  - audio.mp3 (Conversation Script を1ファイルにつないだ音声、または1スクリプト1音声でも可)
  - script.docx (Part3形式: "Conversation Script N (Part 3)" → 英文 → 【日本語訳】 → 日本語)

Output (audio と同じフォルダに出力):
  - aligned_pairs.json   各英文1行 = 1 pair, ja と word-level start/end 付き
  - days_audio_whisper.txt   Conversation Script ごとを1 Dayとした境界

Usage:
  # ローカル無料 (推奨, MacのCPUで動く)
  pip install faster-whisper
  python make_aligned_pairs.py audio.mp3 script.docx

  # モデルサイズ指定 (tiny.en/base.en/small.en/medium.en/large-v3, デフォルト small.en)
  python make_aligned_pairs.py audio.mp3 script.docx --model medium.en

  # OpenAI API版 (有料, 長尺で高速)
  pip install openai
  export OPENAI_API_KEY=sk-...
  python make_aligned_pairs.py audio.mp3 script.docx --api

  # 既に Whisper の word-level JSON があれば再利用
  python make_aligned_pairs.py audio.mp3 script.docx --whisper whisper_words.json
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SECTION_RE = re.compile(r"Conversation\s+Script\s+\d+", re.IGNORECASE)
JA_MARKER = "【日本語訳】"
EN_PREFIX_RE = re.compile(r"^(M\d?|W\d?)\s*[:：]\s*", re.IGNORECASE)
JA_PREFIX_RE = re.compile(r"^(男性\d?|女性\d?)\s*[:：]\s*")


def read_docx_paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        with z.open("word/document.xml") as f:
            tree = ET.parse(f)
    out = []
    for p in tree.getroot().iter(NS + "p"):
        text = "".join(t.text or "" for t in p.iter(NS + "t"))
        if text.strip():
            out.append(text.strip())
    return out


def parse_script(paragraphs: list[str]) -> list[dict]:
    """
    各 'Conversation Script N' を1セクションとし、
    [{ "title": ..., "en_lines": [...], "ja_lines": [...] }, ...] を返す。
    """
    sections = []
    cur = None
    mode = None  # "en" | "ja"
    for line in paragraphs:
        if SECTION_RE.search(line):
            if cur:
                sections.append(cur)
            cur = {"title": line, "en_lines": [], "ja_lines": []}
            mode = "en"
            continue
        if cur is None:
            continue
        if line.startswith(JA_MARKER):
            mode = "ja"
            continue
        if mode == "en":
            cur["en_lines"].append(EN_PREFIX_RE.sub("", line).strip())
        elif mode == "ja":
            cur["ja_lines"].append(JA_PREFIX_RE.sub("", line).strip())
    if cur:
        sections.append(cur)
    return sections


def build_pairs(sections: list[dict]) -> tuple[list[dict], list[int]]:
    """
    各英文1つ = 1 pair。日本語訳が同数なら順番に紐づけ、ズレたら空文字。
    各セクションの先頭 pair の no を返して Day 境界に使う。
    """
    pairs = []
    day_boundary_indices = []  # pair index where each Day starts
    for sec in sections:
        ens = sec["en_lines"]
        jas = sec["ja_lines"]
        if len(ens) != len(jas):
            print(f"  WARN: '{sec['title']}' EN={len(ens)} JA={len(jas)} 行数不一致 → 不足分は空文字", file=sys.stderr)
        day_boundary_indices.append(len(pairs))
        for i, en in enumerate(ens):
            ja = jas[i] if i < len(jas) else ""
            pairs.append({"no": len(pairs) + 1, "en": en, "ja": ja, "start": 0.0, "end": 0.0})
    return pairs, day_boundary_indices


def transcribe_local(audio_path: Path, model_size: str) -> list[dict]:
    """faster-whisper でローカル実行 (無料, Win/Mac/Linux 共通)。"""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR: pip install faster-whisper が必要", file=sys.stderr)
        sys.exit(1)

    print(f"  faster-whisper モデル読込中: {model_size} (初回はDL ~150MB-3GB)")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"  推論中: {audio_path.name} ({audio_path.stat().st_size / 1e6:.1f} MB)")
    segments, info = model.transcribe(str(audio_path), word_timestamps=True, language="en")
    words = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            words.append({"word": w.word, "start": float(w.start), "end": float(w.end)})
    print(f"  → {len(words)} words (lang={info.language}, dur={info.duration:.1f}s)")
    return words


def transcribe_api(audio_path: Path) -> list[dict]:
    """OpenAI Whisper API (有料, $0.006/分)。"""
    try:
        from openai import OpenAI
    except ImportError:
        print("ERROR: pip install openai が必要", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()
    print(f"  Whisper API 呼び出し中: {audio_path.name} ({audio_path.stat().st_size / 1e6:.1f} MB)")
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(
            file=f,
            model="whisper-1",
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
    data = resp.model_dump() if hasattr(resp, "model_dump") else resp
    words = data.get("words", [])
    print(f"  → {len(words)} words")
    return words


WORD_CLEAN_RE = re.compile(r"[^\w']", re.UNICODE)


def normalize_word(w: str) -> str:
    return WORD_CLEAN_RE.sub("", w).lower()


def tokenize(s: str) -> list[str]:
    return [w for w in (normalize_word(t) for t in s.split()) if w]


def align(pairs: list[dict], whisper_words: list[dict]) -> None:
    """
    各 pair の en を whisper_words に貪欲マッチして start/end を埋める。
    マッチ失敗時は前後の pair から線形補間。
    """
    w_norm = [normalize_word(w["word"]) for w in whisper_words]
    cursor = 0
    for pair in pairs:
        s_words = tokenize(pair["en"])
        if not s_words:
            continue
        # cursor から先で s_words を順序通りに探す
        first_match = None
        last_match = None
        si = 0
        wi = cursor
        # マッチ猶予: スクリプト語数の3倍までスキップ可
        max_skip = max(20, len(s_words) * 3)
        while wi < len(w_norm) and si < len(s_words) and (wi - cursor) < max_skip:
            if w_norm[wi] == s_words[si]:
                if first_match is None:
                    first_match = wi
                last_match = wi
                wi += 1
                si += 1
            else:
                wi += 1
        if first_match is not None and last_match is not None:
            pair["start"] = round(whisper_words[first_match]["start"], 3)
            pair["end"] = round(whisper_words[last_match]["end"], 3)
            cursor = last_match + 1
        else:
            print(f"  WARN: no.{pair['no']} アライメント失敗: {pair['en'][:60]}...", file=sys.stderr)

    # 失敗pair (start==end==0) を線形補間
    for i, p in enumerate(pairs):
        if p["start"] == 0.0 and p["end"] == 0.0 and p["no"] > 1:
            prev = pairs[i - 1]
            p["start"] = prev["end"]
            p["end"] = prev["end"] + 2.0  # ダミー2秒、後でエディタで調整


def write_days_file(pairs: list[dict], boundary_indices: list[int], out_path: Path) -> None:
    """各 Day の先頭 pair の start を分:秒で書き出す。split-editor が parseDaysFile() で読み取れる形式。"""
    lines = []
    for i, idx in enumerate(boundary_indices):
        if idx >= len(pairs):
            continue
        sec = int(pairs[idx]["start"])
        m, s = sec // 60, sec % 60
        lines.append(f"DAY{i + 1} Audio")
        lines.append(f"{m}:{s:02d}〜")
        lines.append("")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("docx", type=Path)
    ap.add_argument("--whisper", type=Path, help="既存のWhisper word JSON (再利用)")
    ap.add_argument("--out-dir", type=Path, help="出力先 (デフォルト: audioと同じフォルダ)")
    ap.add_argument("--api", action="store_true", help="OpenAI APIを使用 (デフォルトはローカル)")
    ap.add_argument("--model", default="base.en", help="ローカルモデル: tiny.en/base.en/small.en/medium.en/large-v3 (default: base.en)")
    args = ap.parse_args()

    if not args.audio.exists():
        sys.exit(f"audio not found: {args.audio}")
    if not args.docx.exists():
        sys.exit(f"docx not found: {args.docx}")

    out_dir = args.out_dir or args.audio.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] docx 読み込み: {args.docx.name}")
    paragraphs = read_docx_paragraphs(args.docx)
    sections = parse_script(paragraphs)
    print(f"  → {len(sections)} sections")

    pairs, boundary_indices = build_pairs(sections)
    print(f"  → {len(pairs)} pairs")

    print("[2/4] Whisper 取得")
    if args.whisper and args.whisper.exists():
        words = json.loads(args.whisper.read_text(encoding="utf-8"))
        print(f"  既存JSON再利用: {len(words)} words")
    else:
        if args.api:
            words = transcribe_api(args.audio)
        else:
            words = transcribe_local(args.audio, args.model)
        cache = out_dir / "whisper_words.json"
        cache.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  キャッシュ保存: {cache}")

    print("[3/4] アライメント")
    align(pairs, words)

    print("[4/4] 出力")
    pairs_path = out_dir / "aligned_pairs.json"
    pairs_path.write_text(json.dumps(pairs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → {pairs_path}")

    days_path = out_dir / "days_audio_whisper.txt"
    write_days_file(pairs, boundary_indices, days_path)
    print(f"  → {days_path}")

    print("\nDone. split-editor の '+ New' フォームに以下をアップロード:")
    print(f"  Audio MP3: {args.audio}")
    print(f"  aligned_pairs.json: {pairs_path}")
    print(f"  days_audio_whisper.txt: {days_path}")


if __name__ == "__main__":
    main()
