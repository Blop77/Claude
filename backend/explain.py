"""Plain-language medicine explanations (English / Hindi / Marathi).

Explanations come ONLY from data/medicine_info.json — a reviewed reference —
never from a generative model, so the app can't invent a use or side effect.
"""
from __future__ import annotations

import re
from typing import Any

from matcher import normalise_salt, strength_to_mg

LANGS = ("en", "hi", "mr")


class MedicineInfo:
    def __init__(self, data: dict[str, Any]):
        self.meta = data.get("meta", {})
        self.salts: dict[str, dict] = {normalise_salt(k): v for k, v in data["salts"].items()}
        # Longest names first so "clavulanic acid" wins over a shorter overlap.
        self._names = sorted(self.salts, key=len, reverse=True)

    def get(self, salt_name: str) -> dict | None:
        return self.salts.get(normalise_salt(salt_name))

    def explain(self, salts: list[dict]) -> list[dict]:
        """One explanation block per active ingredient, in all languages."""
        out = []
        for s in salts:
            info = self.get(s["name"])
            out.append({"salt": normalise_salt(s["name"]), "strength": s.get("strength"),
                        "found": info is not None, **(info or {})})
        return out

    def salts_in_text(self, text: str) -> list[dict]:
        """Detect generic (salt) names written directly on a prescription,
        e.g. 'Tab Metformin 500 mg'. Only single-ingredient lines with a
        readable strength are returned; anything else is left unmatched."""
        low = " " + re.sub(r"[^a-z0-9. ]+", " ", text.lower()) + " "
        found = [n for n in self._names if f" {n} " in low]
        if len(found) != 1:
            return []
        # Strength only with an explicit unit: '50' could be 50 mg or 50 mcg.
        # Without a unit we still explain the medicine but never price-match it.
        mg = strength_to_mg(low)
        strength = None if mg is None else (f"{mg:g} mg" if mg >= 1 else f"{mg * 1000:g} mcg")
        return [{"name": found[0], "strength": strength}]
