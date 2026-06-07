#!/usr/bin/env python3
"""
Build Ondoku's RTK kanji lookup bundle.

Inputs:
  - RTK helper kanji.json with 3000 kanji and Heisig keywords.
  - Optional local Anki collection with user-authored RTK stories.

The output is a compact JSON file served from public/dict/rtk-kanji.json.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path


DEFAULT_HELPER_JSON = Path.home() / (
    "Remebering The Kanji Helper/rtk-kanji-search/public/kanji.json"
)
DEFAULT_ANKI_COLLECTION = Path.home() / (
    "Library/Application Support/Anki2/User 1/collection.anki2"
)
DEFAULT_DECK = "Remembering the Kanji 1, 6th edition (2200 kanji)"
DEFAULT_NOTETYPE = "Remembering the Kanji"
DEFAULT_OUT = Path("public/dict/rtk-kanji.json")


def clean_text(value: str) -> str:
    value = value.replace("<br>", "\n").replace("<br />", "\n").replace("<br/>", "\n")
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


FOUNDATION_STORIES = {
    "一": "One stroke, one thing. Picture drawing a single line across a door and saying: only ONE person may enter.",
    "二": "Two parallel lines are a pair of shelves. Put one object on each shelf and count them out loud: TWO.",
    "三": "Three lines are three steps. Climb them one by one and stamp each step: one, two, THREE.",
    "四": "A cramped box grows human legs, one leg running toward each corner. Count the four corners and lock in FOUR.",
    "五": "Five looks like a bent hand tally. Imagine folding your whole hand into the shape and counting all FIVE fingers.",
    "六": "A top hat sits on a pair of legs and begins marching in a parade of SIX steps.",
    "七": "A knife dices a vegetable into exactly SEVEN chunks; the sharp bend of 七 is the chopping motion.",
    "八": "Eight splits open like two paths. Imagine the road dividing into EIGHT lanes the moment this character appears.",
    "九": "A baseball team runs onto the field with NINE players; the hook of 九 is the curve of the last pitch.",
    "十": "Ten is a perfect cross tally. Drive a needle through the center and pin the number TEN in place.",
    "口": "A square mouth opens wide. Anything you say has to pass through that box: MOUTH.",
    "日": "The sun is boxed in the sky like a calendar page. When it appears, the DAY begins.",
    "月": "The moon changes shape night after night until it measures a full MONTH.",
    "田": "A rice field is divided into four wet plots. Stand above it and see the grid of 田.",
    "目": "The box has an extra line because it is not a mouth anymore; it is an EYE with a pupil staring out.",
    "古": "A tombstone opens its mouth and tells stories from ten generations ago. Everything it says is OLD.",
    "吾": "Five mouths all shout the same word at once: I. The chorus fixes 吾 as I.",
    "明": "The sun handles the day and the moon handles the night; together they keep the whole world BRIGHT.",
    "旦": "The sun rests on the floor of the horizon. That first line of light is NIGHTBREAK.",
    "凹": "The shape sinks inward like a dent in metal. Touch the hollow middle and remember CONCAVE.",
    "中": "A stick runs straight through the mouth-box, right through the center: IN.",
    "上": "A magic wand points above the floor line. The spell lifts everything ABOVE.",
    "下": "The ceiling line hangs over a magic wand pointing downward. Everything drops BELOW.",
    "万": "One ceiling holds down a wrapped bundle of zeroes until the count explodes into TEN THOUSAND.",
    "工": "An artificial I-beam on a workbench becomes the basic tool of CRAFT.",
    "左": "Your left hand hangs by your side holding a craft tool. That working hand marks LEFT.",
    "右": "Your right hand rises from your side to your mouth as if swearing an oath. That speaking hand marks RIGHT.",
    "刀": "A curved dagger becomes a full SWORD as soon as you draw the stroke.",
    "刃": "A single drop of blood lands on the sword edge. That marked edge is the BLADE.",
    "子": "A child with arms spread is trying to balance on one leg. The little body is the keyword: CHILD.",
    "母": "A mother is remembered by the breasts that feed the child. The shape points to MAMA.",
    "小": "A small central stroke throws off two tiny sparks. The scattered pieces feel LITTLE.",
    "少": "Start with little, then remove even one drop more. Now there are only a FEW.",
    "大": "A person stretches arms and legs as far as possible to look LARGE.",
    "多": "Evening piles on evening until there are MANY nights.",
    "夕": "One drooping crescent hangs low in the sky. It is the quiet shape of EVENING arriving.",
    "汐": "Water meets evening at the shore. The tide at dusk is EVENTIDE.",
    "石": "A cliff opens a square mouth and spits out a heavy STONE.",
    "川": "Three streams run side by side through the valley: STREAM.",
    "水": "A central stream splashes drops to both sides. Hear the splash and call the character WATER.",
    "氷": "A frozen drop clings to water and turns the whole splash into an ICICLE.",
    "土": "A cross planted in the ground marks the SOIL under your feet.",
    "火": "Two sparks fly off a central flame. The whole character is a campfire shouting FIRE.",
    "点": "A fortune-teller points at four oven flames and marks one exact SPOT.",
    "魚": "A wrapped thing from the rice field is laid over oven-fire; dinner reveals it was FISH.",
    "漁": "Water surrounds the fish while a net pulls it in. That whole action is FISHING.",
    "里": "A rice field sits on soil to mark one country measure: RI.",
    "同": "Monks under one hood speak with one mouth, all saying the SAME thing.",
    "向": "An alien in a helmet opens a mouth and points far away: YONDER.",
    "木": "A trunk with branches and roots is the simplest TREE.",
    "林": "Two trees stand together and become a GROVE.",
    "森": "Three trees crowd together until the grove becomes a FOREST.",
    "本": "Put a line through the root of the tree; that root is the source of a BOOK.",
    "未": "The tree has a top branch that is NOT YET fully grown.",
    "末": "The tree's top branch reaches the EXTREMITY.",
    "牛": "Horns above a strong body make the barnyard shape unmistakable: COW.",
    "介": "An umbrella jams a walking cane into a narrow gap. Everything is JAMMED IN.",
    "界": "A rice field gets divided by the jammed-in marker, creating a whole WORLD of boundaries.",
    "合": "An umbrella, one line, and a mouth gather in one MEETING and FIT together.",
    "塔": "Soil supports flowers above a meeting hall; stack it high and it becomes a PAGODA.",
    "王": "Three realms connected by one vertical line make the KING.",
    "玉": "Add one precious drop to the king's jewel and it becomes a JEWEL.",
    "宝": "A house protecting a jewel is TREASURE.",
    "主": "A drop sits like a flame on the king's candlestick. That owner is the LORD.",
    "金": "Metal under an umbrella shines like a royal treasure: GOLD.",
}

COMPONENT_ALIASES = {
    "animal legs": "legs",
    "augury": "magic wand",
    "barbecue": "oven-fire",
    "bound up": "a wrapped bundle",
    "cane": "walking cane",
    "clam": "shellfish",
    "day": "sun",
    "dirt": "soil",
    "divinging rod": "magic wand",
    "divining rod": "magic wand",
    "flesh": "moon",
    "floor": "one",
    "gravestone": "tombstone",
    "ground": "soil",
    "human legs": "legs",
    "month": "moon",
    "needle": "ten",
    "oyster": "shellfish",
    "part of the body": "moon",
    "pent in": "a cramped box",
    "small": "little",
    "st. bernard": "large",
    "water droplets": "water",
    "water pistol": "water",
    "wood": "tree",
}


def normalize_components(components: list[str], keyword: str) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    keyword_norm = keyword.casefold()

    for raw in components:
        for part in raw.split(";"):
            label = clean_text(part).strip(" .")
            if not label:
                continue
            label = COMPONENT_ALIASES.get(label.casefold(), label)
            key = label.casefold()
            if key in seen:
                continue
            if key == keyword_norm:
                continue
            seen.add(key)
            labels.append(label)

    return labels


def join_words(words: list[str]) -> str:
    if not words:
        return ""
    if len(words) == 1:
        return words[0]
    if len(words) == 2:
        return f"{words[0]} and {words[1]}"
    return f"{', '.join(words[:-1])}, and {words[-1]}"


def noun(label: str) -> str:
    if re.match(r"^(a|an|the)\s", label, flags=re.IGNORECASE):
        return label
    return f"the {label}"


def quote_keyword(keyword: str) -> str:
    return f"'{keyword}'"


def shape_anchor(kanji: str, keyword: str, stroke_count: int | None) -> str:
    anchors = [
        "a chalk mark on a classroom board",
        "a stamped label on a locked box",
        "a trail sign at a fork in the road",
        "a small tattoo on the back of your hand",
        "a warning mark painted on a door",
        "a carved mark on a wooden charm",
        "a glowing icon on a phone screen",
        "a tag tied to a museum exhibit",
    ]
    seed = (ord(kanji[0]) + (stroke_count or 0) + len(keyword)) % len(anchors)
    return anchors[seed]


def keyword_action(keyword: str) -> str:
    lowered = keyword.casefold()
    if any(word in lowered for word in ["haunt", "ghost", "curse", "exorc"]):
        return "the mark vanishes, then reappears whenever you look away, haunting the scene"
    if any(word in lowered for word in ["resuscitate", "revive", "life"]):
        return "the mark shocks the scene back to life"
    if any(word in lowered for word in ["prun", "clip", "cut", "trim"]):
        return "the mark slices away the extra parts until only the keyword remains"
    if any(word in lowered for word in ["upbringing", "raise", "nurture"]):
        return "the mark acts like a parent raising the scene into its final form"
    if any(word in lowered for word in ["plentiful", "many", "abundant"]):
        return "the mark keeps multiplying until the scene is overflowing"
    if any(word in lowered for word in ["measure", "meter", "centimeter", "millimeter", "kilometer", "mile", "inch", "foot", "ton"]):
        return "the mark becomes a measuring label, forcing the scene to be counted in that unit"
    if any(word in lowered for word in ["old", "ancient", "former", "alternate"]):
        return "the mark is found in an old archive, so the age of the object does the remembering"
    if any(word in lowered for word in ["bright", "light", "spark", "shine", "lamp", "candle"]):
        return "the mark suddenly lights up, making the keyword visible in the dark"
    if any(word in lowered for word in ["sound", "voice", "snore", "moo", "song"]):
        return "the mark makes the exact sound of the keyword when you touch it"
    if any(word in lowered for word in ["move", "pass", "walk", "run", "steep"]):
        return "the mark turns into a path, and following that path performs the keyword"
    if any(word in lowered for word in ["food", "bean", "rice", "fish", "candy"]):
        return "the mark is stamped on food, and tasting it reveals the keyword"
    if any(word in lowered for word in ["body", "shin", "neck", "hair", "deaf"]):
        return "the mark appears on the body part that makes the keyword impossible to miss"
    if any(word in lowered for word in ["place", "country", "park", "shop", "quarter"]):
        return "the mark hangs above a place, naming the whole location with the keyword"
    return f"the mark makes the whole scene act out {quote_keyword(keyword)} as literally as possible"


def component_story(kanji: str, keyword: str, primitives: list[str]) -> str:
    keyword_q = quote_keyword(keyword)
    shown = primitives[:4]
    scene = join_words([noun(p) for p in shown])

    if len(shown) == 1:
        return (
            f"Picture {noun(shown[0])} forced to act out {keyword_q}. "
            f"It exaggerates the keyword so clearly that the scene has only one meaning: {keyword_q}. "
            f"Freeze that image onto {kanji}."
        )

    if len(shown) == 2:
        return (
            f"Picture {noun(shown[0])} meeting {noun(shown[1])} in one small scene. "
            f"{shown[0].capitalize()} gives you the shape; {shown[1]} gives it the action; together they make {keyword_q}. "
            f"That snapshot is the mnemonic for {kanji}."
        )

    if len(shown) == 3:
        return (
            f"Stage the kanji as {scene}. {shown[0].capitalize()} sets the place, "
            f"{shown[1]} creates the problem, and {shown[2]} solves it by making {keyword_q}. "
            f"Replay that chain when you see {kanji}."
        )

    return (
        f"Build one scene with {scene}. Start at {shown[0]}, move through {shown[1]} and {shown[2]}, "
        f"then let {shown[3]} deliver the punchline: {keyword_q}. The little sequence is your hook for {kanji}."
    )


def shape_story(kanji: str, keyword: str, stroke_count: int | None) -> str:
    keyword_q = quote_keyword(keyword)
    anchor = shape_anchor(kanji, keyword, stroke_count)
    action = keyword_action(keyword)
    if stroke_count:
        return (
            f"Picture {kanji} as {anchor}. Trace its {stroke_count} strokes slowly; on the last stroke, "
            f"{action}. Lock that final moment to {keyword_q}."
        )
    return (
        f"Picture {kanji} as {anchor}. The shape is not decoration: {action}. "
        f"Hold that scene when you need {keyword_q}."
    )


def fallback_story(
    kanji: str,
    keyword: str,
    components: list[str],
    stroke_count: int | None,
) -> str:
    if kanji in FOUNDATION_STORIES:
        return FOUNDATION_STORIES[kanji]

    primitives = normalize_components(components, keyword)
    if primitives:
        return component_story(kanji, keyword, primitives)
    return shape_story(kanji, keyword, stroke_count)


def copy_collection_for_read(collection: Path, tmp_dir: Path) -> Path:
    tmp = tmp_dir / "collection.anki2"
    shutil.copy2(collection, tmp)
    return tmp


def load_anki_stories(collection: Path, deck_name: str, notetype_name: str) -> dict[str, str]:
    if not collection.exists():
        return {}

    with tempfile.TemporaryDirectory(prefix="ondoku-anki-") as tmp_dir:
        copy = copy_collection_for_read(collection, Path(tmp_dir))
        con = sqlite3.connect(copy)
        try:
            con.create_collation(
                "unicase",
                lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()),
            )
            deck_row = con.execute("SELECT id FROM decks WHERE name = ?", (deck_name,)).fetchone()
            nt_row = con.execute("SELECT id FROM notetypes WHERE name = ?", (notetype_name,)).fetchone()
            if not deck_row or not nt_row:
                return {}

            rows = con.execute(
                """
                SELECT DISTINCT notes.flds
                FROM notes
                JOIN cards ON cards.nid = notes.id
                WHERE cards.did = ? AND notes.mid = ?
                """,
                (deck_row[0], nt_row[0]),
            ).fetchall()
        finally:
            con.close()

    stories: dict[str, str] = {}
    for (fields,) in rows:
        parts = fields.split("\x1f")
        if len(parts) < 4:
            continue
        kanji, story = parts[0].strip(), clean_text(parts[3])
        if kanji and story:
            stories[kanji] = story
    return stories


def build(args: argparse.Namespace) -> dict[str, object]:
    source = json.loads(args.kanji_json.read_text(encoding="utf-8"))
    kanji_rows = source["kanji"]
    stories = load_anki_stories(args.anki_collection, args.deck, args.notetype)

    entries = []
    for row in kanji_rows:
        literal = row["k"]
        keyword = clean_text(row["kw"])
        user_story = stories.get(literal)
        entries.append(
            {
                "k": literal,
                "f": row["f"],
                "kw": keyword,
                "c": row.get("c", []),
                "s": row.get("s"),
                "jlpt": row.get("jlpt"),
                "story": user_story or fallback_story(
                    literal,
                    keyword,
                    row.get("c", []),
                    row.get("s"),
                ),
                "storySource": "anki" if user_story else "generated",
            }
        )

    return {
        "version": 1,
        "entries": entries,
        "stats": {
            "total": len(entries),
            "ankiStories": sum(1 for item in entries if item["storySource"] == "anki"),
            "generatedStories": sum(1 for item in entries if item["storySource"] == "generated"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kanji-json", type=Path, default=DEFAULT_HELPER_JSON)
    parser.add_argument("--anki-collection", type=Path, default=DEFAULT_ANKI_COLLECTION)
    parser.add_argument("--deck", default=DEFAULT_DECK)
    parser.add_argument("--notetype", default=DEFAULT_NOTETYPE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    bundle = build(args)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    stats = bundle["stats"]
    print(
        f"Wrote {args.out}: {stats['total']} kanji, "
        f"{stats['ankiStories']} Anki stories, "
        f"{stats['generatedStories']} generated fallbacks"
    )


if __name__ == "__main__":
    main()
