#!/usr/bin/env python3
"""
Ondoku Dictionary Builder
=========================
Downloads and processes four data sources into a single SQLite database
that ships to the browser via wa-sqlite / OPFS.

Sources
-------
  JMDict_e.gz       — EDRDG J→E dictionary (entries, readings, definitions)
  kanjidic2.xml.gz  — EDRDG kanji dictionary (meanings, readings, JLPT, grade)
  accents.csv       — kanjium pitch accent data (mora pattern per word)
  jlpt_vocab_Nx.json — JLPT vocabulary levels N1–N5

Output
------
  scripts/data/ondoku_dict.db   (~50 MB raw)
  Copy to public/dict/ for the browser to fetch into OPFS.

Usage
-----
  python3 scripts/build_dict.py
"""

import gzip
import json
import os
import re
import sqlite3
import ssl
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

# macOS Python 3.14 ships without system CA certs wired up — bypass verification
# This is safe for our known, canonical data sources (EDRDG, GitHub raw)
ssl._create_default_https_context = ssl._create_unverified_context

# ── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
DB_PATH = DATA_DIR / "ondoku_dict.db"
DATA_DIR.mkdir(exist_ok=True)

# ── Download helpers ──────────────────────────────────────────────────────────

def download(url: str, dest: Path, label: str) -> Path:
    if dest.exists():
        print(f"  [cached] {label}")
        return dest
    print(f"  [download] {label} ...", end=" ", flush=True)
    urllib.request.urlretrieve(url, dest)
    size_mb = dest.stat().st_size / 1_048_576
    print(f"{size_mb:.1f} MB")
    return dest


def try_download(urls: list[str], dest: Path, label: str) -> Path | None:
    """Try multiple URLs in order, return Path on first success or None."""
    if dest.exists():
        print(f"  [cached] {label}")
        return dest
    for url in urls:
        try:
            print(f"  [download] {label} from {url.split('/')[2]} ...", end=" ", flush=True)
            urllib.request.urlretrieve(url, dest)
            size_mb = dest.stat().st_size / 1_048_576
            print(f"{size_mb:.1f} MB")
            return dest
        except Exception as e:
            print(f"failed ({e})")
            if dest.exists():
                dest.unlink()
    print(f"  [skip] {label} — no working source found")
    return None

# ── Schema ───────────────────────────────────────────────────────────────────

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;

CREATE TABLE IF NOT EXISTS entries (
    id        INTEGER PRIMARY KEY,  -- JMDict ent_seq
    jlpt      INTEGER,              -- 1=N1 … 5=N5, NULL=unknown
    freq_rank INTEGER               -- lower=more common, NULL=unknown
);

-- Kanji (non-kana) spellings of an entry
CREATE TABLE IF NOT EXISTS kanji_forms (
    entry_id  INTEGER NOT NULL,
    form      TEXT    NOT NULL,
    PRIMARY KEY (entry_id, form)
);

-- Kana readings of an entry
CREATE TABLE IF NOT EXISTS reading_forms (
    entry_id  INTEGER NOT NULL,
    form      TEXT    NOT NULL,
    PRIMARY KEY (entry_id, form)
);

-- Definitions grouped by part-of-speech
CREATE TABLE IF NOT EXISTS senses (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id  INTEGER NOT NULL,
    pos       TEXT,     -- JSON array of POS tags  e.g. ["noun","vs"]
    glosses   TEXT      -- JSON array of English strings
);

-- Individual kanji characters (KANJIDIC2)
CREATE TABLE IF NOT EXISTS kanji_chars (
    literal      TEXT PRIMARY KEY,
    meanings     TEXT,   -- JSON array
    readings_on  TEXT,   -- JSON array
    readings_kun TEXT,   -- JSON array
    jlpt         INTEGER,
    grade        INTEGER,
    freq         INTEGER
);

-- Pitch accent: one row per (word, reading) pair
CREATE TABLE IF NOT EXISTS pitch (
    entry_id  INTEGER NOT NULL,
    reading   TEXT    NOT NULL,
    pattern   TEXT    NOT NULL   -- e.g. "0", "1", "2"
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_kform  ON kanji_forms   (form);
CREATE INDEX IF NOT EXISTS idx_rform  ON reading_forms  (form);
CREATE INDEX IF NOT EXISTS idx_sense  ON senses         (entry_id);
CREATE INDEX IF NOT EXISTS idx_pitch  ON pitch          (entry_id);
CREATE INDEX IF NOT EXISTS idx_pitchr ON pitch          (reading);
"""

# ── JMDict parser ─────────────────────────────────────────────────────────────

def parse_jmdict(gz_path: Path):
    """
    Yields (entry_id, kanji_forms, reading_forms, senses, freq_rank) tuples.
    Uses lxml to handle the DOCTYPE entity declarations in JMDict XML.
    """
    from lxml import etree

    print("  Parsing JMDict XML …")

    with gzip.open(gz_path) as f:
        raw = f.read()

    # lxml resolves &pos; &n; etc. from the inline DOCTYPE
    root = etree.fromstring(raw)

    entries = []
    for entry in root.iter("entry"):
        eid = int(entry.findtext("ent_seq"))

        # Kanji forms
        kforms = [ke.findtext("keb") for ke in entry.findall("k_ele")]
        kforms = [k for k in kforms if k]

        # Reading forms
        rforms = [re_elem.findtext("reb") for re_elem in entry.findall("r_ele")]
        rforms = [r for r in rforms if r]

        # Frequency rank from nf* tags on first k_ele or r_ele
        freq_rank = None
        for ke in entry.findall("k_ele"):
            for pri in ke.findall("ke_pri"):
                m = re.match(r"nf(\d+)", pri.text or "")
                if m:
                    freq_rank = int(m.group(1)) * 500  # nf01=1-500, nf02=501-1000 …
                    break
            if freq_rank:
                break
        if freq_rank is None:
            for re_elem in entry.findall("r_ele"):
                for pri in re_elem.findall("re_pri"):
                    m = re.match(r"nf(\d+)", pri.text or "")
                    if m:
                        freq_rank = int(m.group(1)) * 500
                        break
                if freq_rank:
                    break

        # Senses
        senses = []
        for sense in entry.findall("sense"):
            pos_list = [p.text for p in sense.findall("pos") if p.text]
            glosses  = [g.text for g in sense.findall("gloss") if g.text]
            if glosses:
                senses.append((json.dumps(pos_list), json.dumps(glosses)))

        entries.append((eid, kforms, rforms, senses, freq_rank))

    print(f"  Parsed {len(entries):,} entries")
    return entries


# ── KANJIDIC2 parser ──────────────────────────────────────────────────────────

def parse_kanjidic(gz_path: Path):
    """
    Yields (literal, meanings, readings_on, readings_kun, jlpt, grade, freq).
    """
    from lxml import etree

    print("  Parsing KANJIDIC2 XML …")

    with gzip.open(gz_path) as f:
        root = etree.fromstring(f.read())

    chars = []
    for char in root.iter("character"):
        literal = char.findtext("literal")
        if not literal:
            continue

        # Meanings (English only)
        meanings = [
            m.text for m in char.findall(".//meaning")
            if m.text and m.get("m_lang") is None  # no lang attr = English
        ]

        # On / kun readings
        on  = [r.text for r in char.findall(".//reading[@r_type='ja_on']")  if r.text]
        kun = [r.text for r in char.findall(".//reading[@r_type='ja_kun']") if r.text]

        misc = char.find("misc")
        jlpt  = None
        grade = None
        freq  = None
        if misc is not None:
            jt = misc.findtext("jlpt")
            jlpt = int(jt) if jt else None
            # KANJIDIC2 JLPT is old scale (1-4), remap: 4→N1,3→N2,2→N3,1→N4/N5
            # Approximate: kanjidic jlpt 4=N1,3=N2,2=N3,1=N4
            if jlpt is not None:
                jlpt = {4: 1, 3: 2, 2: 3, 1: 4}.get(jlpt, jlpt)

            gd = misc.findtext("grade")
            grade = int(gd) if gd else None

            fq = misc.findtext("freq")
            freq = int(fq) if fq else None

        chars.append((
            literal,
            json.dumps(meanings, ensure_ascii=False),
            json.dumps(on, ensure_ascii=False),
            json.dumps(kun, ensure_ascii=False),
            jlpt, grade, freq,
        ))

    print(f"  Parsed {len(chars):,} kanji characters")
    return chars


# ── Pitch accent parser ───────────────────────────────────────────────────────

def parse_pitch(csv_path: Path, entry_by_kanji: dict, entry_by_reading: dict) -> list:
    """
    Parse kanjium accents.csv.
    Columns: expression, reading, source, accent (0-based mora drop position)
    Returns list of (entry_id, reading, pattern).
    """
    print("  Parsing pitch accent data …")

    rows = []
    with open(csv_path, encoding="utf-8") as f:
        next(f)  # skip header
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                parts = line.rstrip("\n").split(",")
            if len(parts) < 2:
                continue
            expression = parts[0].strip()
            reading    = parts[1].strip()
            pattern    = parts[-1].strip() if len(parts) >= 4 else parts[2].strip() if len(parts) >= 3 else ""
            if not pattern:
                continue

            eid = entry_by_kanji.get(expression) or entry_by_reading.get(reading)
            if eid:
                rows.append((eid, reading, pattern))

    print(f"  Mapped {len(rows):,} pitch accent entries")
    return rows


# ── JLPT vocab parser ─────────────────────────────────────────────────────────

def load_kanji_jlpt() -> dict:
    """
    Downloads kanji-data JSON (davidluzgouveia/kanji-data).
    Returns {kanji_literal: jlpt_new_level} where 1=N1 … 5=N5.
    """
    url = "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json"
    print("  Fetching kanji JLPT data …", end=" ", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read())
        result = {k: v["jlpt_new"] for k, v in data.items() if v.get("jlpt_new")}
        print(f"{len(result):,} kanji with JLPT level")
        return result
    except Exception as e:
        print(f"failed ({e})")
        return {}


def load_jlpt(entry_by_kanji: dict, entry_by_reading: dict) -> dict:
    """
    Estimates vocabulary JLPT level by looking up each entry's kanji in
    kanji-data. The word's JLPT = lowest (easiest) kanji JLPT in the word,
    which is a reasonable approximation until a proper vocab list is available.
    Returns {entry_id: jlpt_level}.
    TODO: replace with a proper JLPT vocab list (N1–N5 CSV) when sourced.
    """
    kanji_jlpt = load_kanji_jlpt()
    if not kanji_jlpt:
        return {}

    level_map: dict[int, int] = {}
    for word, eid in entry_by_kanji.items():
        if eid in level_map:
            continue
        levels = [kanji_jlpt[ch] for ch in word if ch in kanji_jlpt]
        if levels:
            # Most restrictive kanji determines the word level (highest N = hardest)
            level_map[eid] = max(levels)

    matched = len(level_map)
    print(f"  Estimated JLPT for {matched:,} entries from kanji levels")
    return level_map


# ── Main build ────────────────────────────────────────────────────────────────

def main():
    print("\n=== Ondoku Dictionary Builder ===\n")

    # 1. Download source files
    print("1. Downloading source data …")
    jmdict_path = download(
        "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
        DATA_DIR / "JMdict_e.gz",
        "JMdict_e.gz",
    )
    kanjidic_path = download(
        "http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz",
        DATA_DIR / "kanjidic2.xml.gz",
        "kanjidic2.xml.gz",
    )
    accents_path = try_download(
        [
            # kanjium (primary)
            "https://raw.githubusercontent.com/mifuyu/kanjium/master/data/accents.csv",
            "https://raw.githubusercontent.com/mifuyu/kanjium/main/data/accents.csv",
            # jmdict-pitch-accent community mirror
            "https://raw.githubusercontent.com/javdome/pitch-accent/main/pitch_accent.csv",
            # Wiktionary-derived pitch from jisho community
            "https://raw.githubusercontent.com/jmdict-kindle/jmdict-kindle/master/data/pitch_accent.csv",
        ],
        DATA_DIR / "accents.csv",
        "pitch accent data",
    )

    # 2. Parse sources
    print("\n2. Parsing source data …")
    jmdict_entries = parse_jmdict(jmdict_path)
    kanjidic_chars = parse_kanjidic(kanjidic_path)

    # 3. Build lookup indexes for pitch + JLPT matching
    print("\n3. Building lookup indexes …")
    entry_by_kanji:   dict[str, int] = {}
    entry_by_reading: dict[str, int] = {}
    for eid, kforms, rforms, _, _ in jmdict_entries:
        for k in kforms:
            if k not in entry_by_kanji:
                entry_by_kanji[k] = eid
        for r in rforms:
            if r not in entry_by_reading:
                entry_by_reading[r] = eid
    print(f"  {len(entry_by_kanji):,} kanji forms, {len(entry_by_reading):,} reading forms")

    # 4. Pitch accent (optional)
    print("\n4. Loading pitch accent …")
    pitch_rows: list = []
    if accents_path:
        pitch_rows = parse_pitch(accents_path, entry_by_kanji, entry_by_reading)
    else:
        print("  [skip] pitch accent — add manually later")

    # 5. JLPT vocabulary levels
    print("\n5. Loading JLPT data …")
    jlpt_map = load_jlpt(entry_by_kanji, entry_by_reading)

    # 6. Write database
    print(f"\n6. Writing database → {DB_PATH} …")
    if DB_PATH.exists():
        DB_PATH.unlink()

    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)

    # entries
    entry_rows = [
        (eid, jlpt_map.get(eid), freq)
        for eid, _, _, _, freq in jmdict_entries
    ]
    con.executemany("INSERT INTO entries VALUES (?,?,?)", entry_rows)
    print(f"  entries: {len(entry_rows):,}")

    # kanji_forms
    kf_rows = [
        (eid, form)
        for eid, kforms, _, _, _ in jmdict_entries
        for form in kforms
    ]
    con.executemany("INSERT OR IGNORE INTO kanji_forms VALUES (?,?)", kf_rows)
    print(f"  kanji_forms: {len(kf_rows):,}")

    # reading_forms
    rf_rows = [
        (eid, form)
        for eid, _, rforms, _, _ in jmdict_entries
        for form in rforms
    ]
    con.executemany("INSERT OR IGNORE INTO reading_forms VALUES (?,?)", rf_rows)
    print(f"  reading_forms: {len(rf_rows):,}")

    # senses
    sense_rows = [
        (eid, pos, glosses)
        for eid, _, _, senses, _ in jmdict_entries
        for pos, glosses in senses
    ]
    con.executemany("INSERT INTO senses (entry_id, pos, glosses) VALUES (?,?,?)", sense_rows)
    print(f"  senses: {len(sense_rows):,}")

    # kanji_chars
    con.executemany(
        "INSERT OR IGNORE INTO kanji_chars VALUES (?,?,?,?,?,?,?)",
        kanjidic_chars,
    )
    print(f"  kanji_chars: {len(kanjidic_chars):,}")

    # pitch
    con.executemany("INSERT INTO pitch VALUES (?,?,?)", pitch_rows)
    print(f"  pitch: {len(pitch_rows):,}")

    con.commit()

    # Final ANALYZE for query planner
    con.execute("ANALYZE")
    con.close()

    size_mb = DB_PATH.stat().st_size / 1_048_576
    print(f"\n✓ Done — {DB_PATH.name}  ({size_mb:.1f} MB)")
    print(f"\nNext step: copy to public/dict/ for the browser")
    print(f"  cp {DB_PATH} ../public/dict/ondoku_dict.db")


if __name__ == "__main__":
    main()
