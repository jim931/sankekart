from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = Path("/Users/jim/Downloads/Pensum_NVK_NSNF_2025.pdf")
OUTPUT_PATH = ROOT / "data" / "nsnf-pensum-2025.json"

STATUS_ORDER = [
    "Meget giftig",
    "Spiselig med merknad",
    "Giftig",
    "Spiselig",
]

CATEGORY_PHRASES = [
    "Flere fremmede og rødlistede arter i slekta.",
    "Flere fremmede og rødlistede arter i slekta",
    "Flere fremmede- og rødlistede arter i slekta",
    "Flere fremmede arter i slekta",
    "Noen arter i slekta er rødlistet",
    "CR",
    "EN",
    "VU",
    "NT",
    "SE",
    "HI",
    "PH",
    "LO",
]

CAUTION_MAP = {
    "giftkjeks": {
        "compound": "Alkaloider",
        "cautionText": "Hele planten er meget giftig. Symptomer kan komme raskt med kramper, mage-tarm-plager, hjerterytmeforstyrrelser, muskellammelser og pustesvikt.",
    },
    "revebjelle": {
        "compound": "Hjerteaktive glykosider",
        "cautionText": "Hele planten er meget giftig, også tørket materiale. Kan gi mage-tarm-symptomer og alvorlig hjertepåvirkning.",
    },
    "selsnepe": {
        "compound": "Cicutoksin",
        "cautionText": "Hele planten er meget giftig. Kan gi kraftige mage-tarm-symptomer, langvarige kramper, bevisstløshet og pustesvikt.",
    },
    "tyrihjelm": {
        "compound": "Alkaloider",
        "cautionText": "Hele planten er meget giftig, særlig rotstokken. Plantesaft i store mengder på huden kan også være farlig.",
    },
    "barlind": {
        "compound": "Alkaloider",
        "cautionText": "Hele planten er giftig unntatt den røde fruktkappen rundt frøet. Frøet er fortsatt giftig.",
    },
    "hundepersille": {
        "compound": "Alkaloider",
        "cautionText": "Hele planten er giftig og ligner andre farlige skjermplanter. Få kjente forgiftningstilfeller, men høy risiko ved forveksling.",
    },
    "liljekonvall": {
        "compound": "Hjerteaktive glykosider",
        "cautionText": "Hele planten er giftig og kan gi mage-tarm-symptomer etterfulgt av hjerterytmeforstyrrelser.",
    },
    "ormetelg": {
        "compound": "Filicin",
        "cautionText": "Hele planten er giftig, særlig rotdeler og nedre del av stilken. Alvorlige forgiftninger kan gi synsforstyrrelser og blindhet.",
    },
    "sverdlilje": {
        "compound": "Ukjent giftstoff",
        "cautionText": "Hele planten inneholder irriterende stoffer som kan gi svie i munnhulen og mage-tarmreaksjoner.",
    },
    "burot": {
        "compound": "Tujon og eteriske oljer",
        "cautionText": "Store og gjentatte inntak frarådes. Mange reagerer også på pollen fra planten.",
    },
    "einer": {
        "compound": "Terpener",
        "cautionText": "Inneholder eteriske oljer som i store mengder kan skade nyrene.",
    },
    "fjæresauløk": {
        "compound": "Cyanogene glykosider",
        "cautionText": "Bør brukes med forsiktighet og varmebehandles. Mindre inntak er normalt ikke forventet å gi forgiftning.",
    },
    "kjempebjørnekjeks": {
        "compound": "Furokumariner",
        "cautionText": "Fototoksisk plantesaft kan gi smerter, blemmer og arr ved soleksponering i flere dager etter kontakt.",
    },
    "kystbjørnekjeks": {
        "compound": "Furokumariner",
        "cautionText": "Fototoksisk plantesaft kan gi smerter, blemmer og arr ved soleksponering i flere dager etter kontakt.",
    },
    "tromsøpalme": {
        "compound": "Furokumariner",
        "cautionText": "Fototoksisk plantesaft kan gi smerter, blemmer og arr ved soleksponering i flere dager etter kontakt.",
    },
    "kvann": {
        "compound": "Furokumariner",
        "cautionText": "Fototoksisk plantesaft kan gi smerter, blemmer og arr ved soleksponering etter kontakt.",
    },
    "mjødurt": {
        "compound": "Salisylsyre",
        "cautionText": "Salisylsyre kan virke irriterende på mage-tarm-kanalen og bør brukes med måte.",
    },
    "pors": {
        "compound": "Terpener",
        "cautionText": "Store inntak kan gi hodepine.",
    },
    "rogn": {
        "compound": "Cyanogene glykosider",
        "cautionText": "Frø og blad inneholder amygdalin. Behandling som koking eller tørking reduserer risikoen, men store inntak bør unngås.",
    },
    "gulaks": {
        "compound": "Kumarin",
        "cautionText": "Kumarin er levertoksisk i store mengder og kan omdannes av muggsopp til et blodfortynnende stoff.",
    },
    "hvitsteinkløver": {
        "compound": "Kumarin",
        "cautionText": "Kumarin er levertoksisk i store mengder og kan omdannes av muggsopp til et blodfortynnende stoff.",
    },
    "myske": {
        "compound": "Kumarin",
        "cautionText": "Kumarin er levertoksisk i store mengder og kan omdannes av muggsopp til et blodfortynnende stoff.",
    },
    "gulmaure": {
        "compound": "Kumarin",
        "cautionText": "Kumarin er levertoksisk i store mengder og kan omdannes av muggsopp til et blodfortynnende stoff.",
    },
}

TREE_KEYWORDS = {"bjørk", "gran", "furu", "rogn", "alm", "lind", "spisslønn", "barlind"}
SHRUB_KEYWORDS = {"einer", "pors", "rynkerose"}


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def slugify(text: str) -> str:
    normalized = text.lower()
    normalized = normalized.replace("å", "a").replace("æ", "ae").replace("ø", "o")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def base_common_name(text: str) -> str:
    text = re.sub(r"\s*\([^)]*\)", "", text)
    text = text.replace("- ", "-")
    return normalize_spaces(text)


def normalize_common_name(text: str) -> str:
    text = normalize_spaces(text)
    text = text.replace("  ", " ")
    text = text.replace("bjørnek- jeksslekta", "bjørnekjeksslekta")
    return text


def read_pages(reader: PdfReader, start: int, end: int) -> list[str]:
    lines: list[str] = []
    for idx in range(start, end):
        for line in (reader.pages[idx].extract_text() or "").splitlines():
            line = normalize_spaces(line)
            if not line:
                continue
            if line == "PENSUMARTER":
                continue
            if line.startswith("Norsk navn") or line.startswith("Vitenskapelig navn"):
                continue
            lines.append(line)
    return lines


def join_entries(lines: list[str]) -> list[str]:
    entries: list[str] = []
    buffer: list[str] = []
    for line in lines:
        buffer.append(line)
        joined = normalize_spaces(" ".join(buffer))
        if any(joined.endswith(status) for status in STATUS_ORDER):
            entries.append(joined)
            buffer = []
    if buffer:
        entries.append(normalize_spaces(" ".join(buffer)))
    return entries


def strip_status(entry: str) -> tuple[str, str]:
    for status in STATUS_ORDER:
        if entry.endswith(status):
            return entry[: -len(status)].strip(), status
    raise ValueError(f"Missing status in entry: {entry}")


def strip_category(entry: str) -> tuple[str, str]:
    for phrase in CATEGORY_PHRASES:
        if entry.endswith(phrase):
            return entry[: -len(phrase)].strip(), phrase
    return entry, ""


def looks_like_scientific_tokens(tokens: list[str]) -> bool:
    if not tokens:
        return False
    genus = tokens[0]
    if len(tokens) >= 2 and re.fullmatch(r"[A-Z]", tokens[0]) and re.fullmatch(r"[a-z]+", tokens[1]):
        genus = tokens[0] + tokens[1]
        tokens = [genus] + tokens[2:]
    if not re.fullmatch(r"[A-Z][a-z-]+", genus):
        return False
    for token in tokens[1:]:
        if token in {"subsp.", "subsp"}:
            continue
        if not re.fullmatch(r"[a-z-]+", token):
            return False
    return True


def split_common_and_scientific(entry: str) -> tuple[str, str]:
    tokens = entry.split()
    for index in range(1, len(tokens) + 1):
        common = tokens[:index]
        scientific = tokens[index:]
        if looks_like_scientific_tokens(scientific):
            return normalize_spaces(" ".join(common)), normalize_scientific(" ".join(scientific))
    raise ValueError(f"Could not parse common/scientific names from: {entry}")


def normalize_scientific(text: str) -> str:
    text = normalize_spaces(text)
    text = text.replace("T axus", "Taxus")
    text = text.replace("T araxacum", "Taraxacum")
    text = text.replace("filixmas", "filix-mas")
    return text


def infer_game_category(common_name: str, norm_status: str) -> str:
    normalized = base_common_name(common_name).lower()
    words = {part for part in re.split(r"[^a-zæøå-]+", normalized) if part}
    if "giftig" in norm_status.lower():
        return "Giftig plante"
    if words & TREE_KEYWORDS:
        return "Tre"
    if words & SHRUB_KEYWORDS:
        return "Busk"
    return "Vekst"


def infer_rarity_score(category: str, norm_status: str) -> int:
    if norm_status == "Meget giftig":
        return 5
    if norm_status == "Giftig":
        return 4
    if category in {"CR", "EN", "VU", "NT"}:
        return 4
    if category in {"SE", "HI", "PH"}:
        return 4
    if "rødlistede" in category.lower() or "rødlistet" in category.lower():
        return 3
    if "fremmede" in category.lower():
        return 3
    return 2


def infer_rarity_label(category: str, norm_status: str) -> str:
    if norm_status == "Meget giftig":
        return "Kritisk læringsart"
    if norm_status == "Giftig":
        return "Varsomhetsart"
    if category in {"CR", "EN", "VU", "NT"}:
        return "Rødlistet"
    if category in {"SE", "HI", "PH"}:
        return "Særlig aktuell"
    if "rødlistede" in category.lower() or "rødlistet" in category.lower():
        return "Artsgruppe"
    if "fremmede" in category.lower():
        return "Vid gruppe"
    return "Pensumart"


def infer_difficulty_score(common_name: str, scientific_name: str, category: str, norm_status: str) -> int:
    score = 2
    if "giftig" in norm_status.lower():
        score += 2
    if norm_status == "Spiselig med merknad":
        score += 1
    if "(" in common_name:
        score += 1
    if "subsp." in scientific_name:
        score += 1
    if "rødlistede" in category.lower() or "rødlistet" in category.lower() or "fremmede" in category.lower():
        score += 1
    return min(score, 5)


def infer_difficulty_label(score: int) -> str:
    return {
        1: "Enkel",
        2: "Lett",
        3: "Middels",
        4: "Krevende",
        5: "Høy risiko",
    }[score]


def infer_seasonality_label(common_name: str) -> str:
    normalized = common_name.lower()
    if any(term in normalized for term in {"løk", "nesle", "skjørbuksurt", "vassarve", "løvetann"}):
        return "Vår og forsommer"
    if any(term in normalized for term in {"bær", "rogn"}):
        return "Sensommer og høst"
    if any(term in normalized for term in {"gran", "furu", "bjørk", "einer", "barlind"}):
        return "Flere sesonger"
    return "Sesongavhengig"


def build_default_safety_note(common_name: str, norm_status: str) -> str:
    if norm_status == "Meget giftig":
        return "Meget giftig art. Appen skal kun brukes til læring og aldri som grunnlag for sanking eller smaksprøving."
    if norm_status == "Giftig":
        return "Giftig art. Bruk funnet som forvekslingslæring og dobbeltsjekk alltid artskjennetegn i felt."
    if norm_status == "Spiselig med merknad":
        return "Pensumarten er spiselig med merknad. Tilberedning, mengde eller innholdsstoffer må vurderes nøye før eventuell bruk."
    if "(" in common_name:
        return "Pensumet godtar her slektsnivå eller artsgruppe. Appen bør belønne trygg gjenkjenning uten å late som alt er artsbestemt."
    return "Bruk alltid flere kjennetegn og en trygg artskontroll før noe vurderes som mat."


def build_note_fields(common_name: str, norm_status: str) -> tuple[str, str]:
    note = CAUTION_MAP.get(base_common_name(common_name).lower())
    if note:
        return note["compound"], note["cautionText"]
    return "", build_default_safety_note(common_name, norm_status)


def build_record(entry: str) -> dict:
    without_status, norm_status = strip_status(entry)
    without_category, category = strip_category(without_status)
    common_name, scientific_name = split_common_and_scientific(without_category)
    common_name = normalize_common_name(common_name)
    difficulty_score = infer_difficulty_score(common_name, scientific_name, category, norm_status)
    rarity_score = infer_rarity_score(category, norm_status)
    compound, safety_note = build_note_fields(common_name, norm_status)
    return {
        "id": slugify(common_name),
        "productName": common_name,
        "scientificName": scientific_name,
        "category": infer_game_category(common_name, norm_status),
        "normStatus": norm_status,
        "artsdatabankenCategory": category,
        "rarityScore": rarity_score,
        "difficultyScore": difficulty_score,
        "rarityLabel": infer_rarity_label(category, norm_status),
        "difficultyLabel": infer_difficulty_label(difficulty_score),
        "seasonalityLabel": infer_seasonality_label(common_name),
        "safetyCompound": compound,
        "safetyNote": safety_note,
    }


def main() -> None:
    reader = PdfReader(str(PDF_PATH))
    entries = join_entries(read_pages(reader, 4, 7))
    records = [build_record(entry) for entry in entries]
    OUTPUT_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(records)} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
