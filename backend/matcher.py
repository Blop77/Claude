"""Core matching logic for MedLens.

Pure Python, no AWS dependencies, so it can be unit-tested locally.

Flow:
    prescription text  ->  parse_lines()  ->  [{query, units}]
    each query         ->  match_brand()  ->  brand entry (salts + strengths)
    brand salts        ->  find_generic() ->  Jan Aushadhi product with the
                                              SAME salts, SAME strengths, SAME form
"""
from __future__ import annotations

import difflib
import re
from typing import Any

# --------------------------------------------------------------------------
# Normalisation helpers
# --------------------------------------------------------------------------

_UNIT_TO_MG = {"mg": 1.0, "g": 1000.0, "gm": 1000.0, "mcg": 0.001, "ug": 0.001}

# Words on a prescription line that are not part of the medicine name.
_NOISE = {
    "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules",
    "syp", "syrup", "inj", "injection", "rx", "od", "bd", "tds", "hs", "sos",
    "x", "days", "day", "week", "weeks", "month", "after", "before", "food",
    "meal", "meals", "morning", "night", "daily", "once", "twice",
}

_FORM_ALIASES = {
    "tab": "tablet", "tabs": "tablet", "tablet": "tablet", "tablets": "tablet",
    "cap": "capsule", "caps": "capsule", "capsule": "capsule", "capsules": "capsule",
}


def strength_to_mg(text: str) -> float | None:
    """'500 mg' -> 500.0, '0.5g' -> 500.0, '25mcg' -> 0.025."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mcg|ug|mg|gm|g)\b", text.lower())
    if not m:
        return None
    return round(float(m.group(1)) * _UNIT_TO_MG[m.group(2)], 4)


# Salt forms that don't change which active ingredient it is. Strength on Indian
# labels is normally stated for the active moiety, so these are safe to drop.
_SALT_FORMS = {
    "hydrochloride", "hcl", "sodium", "potassium", "calcium", "besylate", "besilate",
    "maleate", "succinate", "tartrate", "fumarate", "mesylate", "trihydrate",
    "dihydrate", "monohydrate", "sulphate", "sulfate", "magnesium", "ip", "bp", "usp",
}
_SALT_ALIASES = {
    "clavulanate": "clavulanic acid", "clavulanic": "clavulanic acid",
    "amoxycillin": "amoxicillin", "acetylsalicylic acid": "aspirin",
    "thyroxine": "levothyroxine", "acetaminophen": "paracetamol",
}


def normalise_salt(name: str) -> str:
    """'Metformin Hydrochloride IP' -> 'metformin'; 'Potassium Clavulanate' -> 'clavulanic acid'."""
    words = [w for w in re.sub(r"[^a-z ]+", " ", name.lower()).split() if w not in _SALT_FORMS]
    joined = " ".join(words)
    return _SALT_ALIASES.get(joined, joined)


def salt_key(salts: list[dict[str, Any]]) -> tuple:
    """Order-independent key for a salt combination, e.g.
    ((amoxicillin, 500.0), (clavulanic acid, 125.0))."""
    return tuple(sorted((normalise_salt(s["name"]), strength_to_mg(s["strength"])) for s in salts))


def _clean(text: str) -> str:
    return re.sub(r"[^a-z0-9. ]+", " ", text.lower()).strip()


# --------------------------------------------------------------------------
# Prescription line parsing
# --------------------------------------------------------------------------

def parse_dose_per_day(line: str) -> int | None:
    """'1-0-1' -> 2, '1-1-1' -> 3, 'BD' -> 2, 'TDS' -> 3, 'OD' -> 1."""
    m = re.search(r"\b([0-2])\s*-\s*([0-2])\s*-\s*([0-2])\b", line)
    if m:
        return sum(int(g) for g in m.groups()) or None
    low = f" {line.lower()} "
    for word, n in ((" tds ", 3), (" bd ", 2), (" od ", 1), (" hs ", 1)):
        if word in low:
            return n
    return None


def parse_days(line: str) -> int | None:
    """'x 30 days' / 'for 2 weeks' / '1 month' -> number of days."""
    low = line.lower()
    m = re.search(r"(\d+)\s*(day|days|d)\b", low)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*(week|weeks|wk)\b", low)
    if m:
        return int(m.group(1)) * 7
    m = re.search(r"(\d+)\s*(month|months)\b", low)
    if m:
        return int(m.group(1)) * 30
    return None


def parse_lines(text: str, default_units: int = 30) -> list[dict[str, Any]]:
    """Split OCR/typed text into candidate medicine lines.

    Returns [{"raw": line, "query": cleaned name, "units": units/month}].
    Units = tablets per day * days (capped to a 30-day month); falls back to
    `default_units` when dosage can't be read. The user can edit it in the UI.
    """
    out = []
    for raw in text.splitlines():
        raw = raw.strip()
        if len(raw) < 3:
            continue
        name_part = re.sub(r"^\s*(?:\d{1,2}|[a-z])\s*[.)]\s+", " ", raw, flags=re.I)  # "2. ", "3) ", "a. " list numbers
        name_part = re.sub(r"\b[0-2]\s*-\s*[0-2]\s*-\s*[0-2]\b", " ", name_part)
        name_part = re.sub(r"\d+\s*(days?|weeks?|wks?|months?|d)\b", " ", name_part, flags=re.I)
        cleaned = _clean(name_part)
        words = [w.strip(".") for w in cleaned.split() if w.strip(".") and w.strip(".") not in _NOISE]
        query = " ".join(words).strip()
        # Must contain at least one alphabetic word of 3+ letters.
        if not re.search(r"[a-z]{3,}", query):
            continue
        per_day = parse_dose_per_day(raw)
        days = parse_days(raw)
        if per_day:
            units = per_day * min(days or 30, 30)
        else:
            units = default_units
        out.append({"raw": raw, "query": query, "units": units,
                    "schedule": parse_schedule(raw), "days": days})
    return out


def parse_schedule(line: str) -> list[int] | None:
    """'1-0-1' -> [1, 0, 1] (morning, afternoon, night). OD/BD/TDS are not
    mapped to times because doctors use them differently; return None."""
    m = re.search(r"\b([0-2])\s*-\s*([0-2])\s*-\s*([0-2])\b", line)
    return [int(g) for g in m.groups()] if m else None


# --------------------------------------------------------------------------
# Catalogue matching
# --------------------------------------------------------------------------

class Catalog:
    def __init__(self, data: dict[str, Any], info=None):
        self.info = info  # optional explain.MedicineInfo
        self.brands: list[dict] = data["brands"]
        self.generics: list[dict] = data["generics"]
        self.meta: dict = data.get("meta", {})
        self._brand_names = [_clean(b["brand"]) for b in self.brands]
        self._generic_index: dict[tuple, list[dict]] = {}
        for g in self.generics:
            key = (salt_key(g["salts"]), g["form"].lower())
            self._generic_index.setdefault(key, []).append(g)

    # -- brand lookup -------------------------------------------------------

    def match_brand(self, query: str, cutoff: float = 0.72) -> tuple[dict | None, float]:
        """Fuzzy-match a prescription line to a brand.

        Strength in the query must agree with the brand's strength when both
        are present, so 'Glycomet 1000' never silently matches 'Glycomet 500'.
        """
        q = _clean(query)
        q_mg = strength_to_mg(q) or _bare_number(q)
        best, best_score = None, 0.0
        for brand, name in zip(self.brands, self._brand_names):
            # Compare against the brand's leading word(s) as well as full name,
            # because OCR lines carry extra dosage text.
            brand_word = name.split()[0]
            q_words = q.split()
            word_score = max((difflib.SequenceMatcher(None, brand_word, w).ratio() for w in q_words), default=0)
            full_score = difflib.SequenceMatcher(None, name, q).ratio()
            score = max(word_score * 0.9 + 0.1 * full_score, full_score)
            if score < cutoff:
                continue
            b_mg = _primary_strength_mg(brand)
            if q_mg is not None and b_mg is not None:
                if abs(q_mg - b_mg) > 1e-6:
                    continue  # same brand family, wrong strength
                score += 0.05  # prefer exact strength agreement
            if score > best_score:
                best, best_score = brand, score
        return best, round(min(best_score, 1.0), 3)

    # -- generic lookup -----------------------------------------------------

    def find_generic(self, salts: list[dict], form: str) -> dict | None:
        """Exact match on salts + strengths + dosage form. No fuzzy here:
        a near-miss is reported as 'no equivalent', never substituted."""
        options = self._generic_index.get((salt_key(salts), form.lower()), [])
        if not options:
            return None
        return min(options, key=unit_price)

    # -- full pipeline ------------------------------------------------------

    def analyse(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        results = []
        total_brand = total_generic = 0.0
        for item in items:
            brand, confidence = self.match_brand(item["query"])
            units = max(int(item.get("units") or 0), 0)
            row: dict[str, Any] = {
                "raw": item.get("raw", item["query"]),
                "query": item["query"],
                "units": units,
                "schedule": item.get("schedule"),
                "days": item.get("days"),
                "status": "no_match",
            }
            salts = brand["salts"] if brand else (self.info.salts_in_text(item["query"]) if self.info else [])
            if self.info and salts:
                row["explanations"] = self.info.explain(salts)
            if not brand and salts:
                # Prescription names the generic directly: explain it, and show
                # the Jan Aushadhi price when strength is known. No brand price,
                # so no "saving" is claimed.
                row.update({"generic_name": salts, "status": "generic_named"})
                if salts[0]["strength"]:
                    generic = self.find_generic(salts, "tablet")
                    if generic:
                        row.update({"generic": _public(generic),
                                    "generic_unit_price": round(unit_price(generic), 2),
                                    "generic_monthly": round(unit_price(generic) * units, 2)})
            if brand:
                generic = self.find_generic(brand["salts"], brand["form"])
                row.update({
                    "brand": _public(brand),
                    "confidence": confidence,
                    "brand_unit_price": round(unit_price(brand), 2),
                    "brand_monthly": round(unit_price(brand) * units, 2),
                    "status": "no_generic",
                })
                if generic:
                    g_month = unit_price(generic) * units
                    b_month = unit_price(brand) * units
                    row.update({
                        "generic": _public(generic),
                        "generic_unit_price": round(unit_price(generic), 2),
                        "generic_monthly": round(g_month, 2),
                        "monthly_saving": round(b_month - g_month, 2),
                        "saving_pct": round(100 * (b_month - g_month) / b_month, 1) if b_month else 0,
                        "status": "matched",
                    })
                    total_brand += b_month
                    total_generic += g_month
            results.append(row)
        saving = total_brand - total_generic
        return {
            "items": results,
            "summary": {
                "matched": sum(r["status"] == "matched" for r in results),
                "total": sum(r["status"] != "no_match" for r in results),  # medicines, not header lines
                "brand_monthly": round(total_brand, 2),
                "generic_monthly": round(total_generic, 2),
                "monthly_saving": round(saving, 2),
                "yearly_saving": round(saving * 12, 2),
                "saving_pct": round(100 * saving / total_brand, 1) if total_brand else 0,
            },
            "data_notice": self.meta.get("notice"),
            "is_sample_data": bool(self.meta.get("is_sample")),
            "info_notice": (self.info.meta.get("review_notice") if self.info and not self.info.meta.get("reviewed") else None),
        }


def unit_price(entry: dict) -> float:
    return float(entry["mrp"]) / float(entry["pack_units"])


def _primary_strength_mg(brand: dict) -> float | None:
    if len(brand["salts"]) != 1:
        return None
    return strength_to_mg(brand["salts"][0]["strength"])


def _bare_number(q: str) -> float | None:
    """'glycomet 500' -> 500.0 (strength written without a unit)."""
    m = re.search(r"\b(\d+(?:\.\d+)?)\b", q)
    return float(m.group(1)) if m else None


def _public(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if not k.startswith("_")}
