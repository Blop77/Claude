"""Build data/catalog.json (and optionally data/kendras.json) from real data.

You need:
  1. generics CSV: the official PMBJP / Jan Aushadhi product list
     (janaushadhi.gov.in -> Product List; save/convert it to CSV).
     Needed columns (names configurable with flags):
       code  (Drug Code)   name (Generic Name)   pack (Unit Size, e.g. "10's")   mrp (MRP)
  2. brands CSV in this simple format (one row per brand; combos use ' + '):
       brand,salts,strengths,form,pack_units,mrp,source
       Glycomet 500,metformin,500 mg,tablet,20,<MRP from pack>,<where price came from>
       Augmentin 625 Duo,amoxicillin + clavulanic acid,500 mg + 125 mg,tablet,10,<MRP>,<source>
     form is one of: tablet, capsule, tablet-mr, capsule-mr (mr = SR/ER/XR/CR).
     Fill MRPs from the printed pack or a source you can cite. Check the licence
     of any dataset you use for this.
  3. (optional) kendras CSV: id,name,address,pincode,lat,lon

Usage:
  python3 scripts/import_catalog.py --generics pmbjp.csv --brands brands.csv [--kendras kendras.csv]

Rows that can't be parsed are reported, not guessed.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from matcher import strength_to_mg  # noqa: E402

FORMS = [("tablet", "tablet"), ("tab", "tablet"), ("capsule", "capsule"), ("cap", "capsule")]
_STRENGTH = r"\d+(?:\.\d+)?\s*(?:mcg|ug|mg|gm|g)\b"


_MODIFIED_RELEASE = r"\b(sustained|extended|prolonged|modified|controlled)[- ]release\b|\b(sr|er|xr|pr|cr|mr)\b"


def detect_form(name: str) -> str | None:
    """'tablet', 'capsule', or 'tablet-mr' for modified release. SR/ER products
    are NOT interchangeable with plain ones, so they get a separate form."""
    low = name.lower()
    for word, form in FORMS:
        if re.search(rf"\b{word}s?\b", low):
            return form + "-mr" if re.search(_MODIFIED_RELEASE, low) else form
    return None  # syrups, injections etc. are skipped for now


def parse_generic_name(name: str):
    """'Glimepiride 1 mg and Metformin Hydrochloride 500 mg Tablets IP'
    -> [{'name': 'Glimepiride', 'strength': '1 mg'}, {'name': 'Metformin Hydrochloride', 'strength': '500 mg'}]

    Also handles 'Metformin Hydrochloride Tablets IP 500 mg' (strength at the end)."""
    clean = re.sub(r"\(.*?\)", " ", name)
    # Release type is captured by detect_form(); remove it here only so the salt name is clean.
    clean = re.sub(_MODIFIED_RELEASE + r"|\bds\b", " ", clean, flags=re.I)
    clean = re.sub(r"\b(film[- ]coated|gastro[- ]resistant|dispersible|chewable|uncoated|enteric[- ]coated)\b", " ", clean, flags=re.I)
    clean = re.sub(r"\b(tablets?|capsules?|ip|bp|usp)\b", " ", clean, flags=re.I)
    parts = re.split(r"\s+\+\s+|\s+and\s+|\s*,\s*|\s*&\s*", clean, flags=re.I)
    salts = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = re.search(_STRENGTH, part, flags=re.I)
        if not m:
            return None
        salt = (part[:m.start()] + part[m.end():]).strip(" -/")
        salt = re.sub(r"\s+", " ", salt)
        if not salt or not re.search(r"[a-z]{3,}", salt, flags=re.I):
            return None
        salts.append({"name": salt, "strength": m.group(0)})
    return salts or None


def pack_units(text: str) -> int | None:
    m = re.search(r"(\d+)", str(text))
    return int(m.group(1)) if m else None


def load_generics(path, col):
    out, skipped = [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            name = (row.get(col["name"]) or "").strip()
            form = detect_form(name)
            salts = parse_generic_name(name) if form else None
            units = pack_units(row.get(col["pack"], ""))
            try:
                mrp = float(str(row.get(col["mrp"], "")).replace(",", ""))
            except ValueError:
                mrp = None
            if not (form and salts and units and mrp):
                skipped.append(name)
                continue
            if any(strength_to_mg(s["strength"]) is None for s in salts):
                skipped.append(name)
                continue
            out.append({"code": str(row.get(col["code"], "")).strip(), "name": name, "salts": salts,
                        "form": form, "pack_units": units, "mrp": mrp})
    return out, skipped


def load_brands(path):
    out, skipped = [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            names = [s.strip() for s in row["salts"].split("+")]
            strengths = [s.strip() for s in row["strengths"].split("+")]
            try:
                assert len(names) == len(strengths) and all(strength_to_mg(s) for s in strengths)
                out.append({"brand": row["brand"].strip(),
                            "salts": [{"name": n, "strength": s} for n, s in zip(names, strengths)],
                            "form": row["form"].strip().lower(), "pack_units": int(row["pack_units"]),
                            "mrp": float(row["mrp"]), "source": row.get("source", "").strip()})
            except (AssertionError, ValueError, KeyError):
                skipped.append(row.get("brand"))
    return out, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--generics", required=True)
    ap.add_argument("--brands", required=True)
    ap.add_argument("--kendras")
    ap.add_argument("--col-code", default="Drug Code")
    ap.add_argument("--col-name", default="Generic Name")
    ap.add_argument("--col-pack", default="Unit Size")
    ap.add_argument("--col-mrp", default="MRP")
    a = ap.parse_args()

    generics, g_skip = load_generics(a.generics, {"code": a.col_code, "name": a.col_name, "pack": a.col_pack, "mrp": a.col_mrp})
    brands, b_skip = load_brands(a.brands)
    catalog = {"meta": {"is_sample": False, "notice": None,
                        "source": f"PMBJP product list ({Path(a.generics).name}); brands ({Path(a.brands).name})"},
               "brands": brands, "generics": generics}
    (ROOT / "data" / "catalog.json").write_text(json.dumps(catalog, indent=1))
    print(f"generics: {len(generics)} imported, {len(g_skip)} skipped (non-tablet/capsule or unparseable)")
    print(f"brands:   {len(brands)} imported, {len(b_skip)} skipped: {b_skip[:10]}")
    if g_skip:
        Path(ROOT / "data" / "skipped_generics.txt").write_text("\n".join(g_skip))
        print("  see data/skipped_generics.txt")

    if a.kendras:
        rows = []
        with open(a.kendras, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                try:
                    rows.append({"id": r["id"], "name": r["name"], "address": r["address"],
                                 "pincode": str(r["pincode"]).strip(), "lat": float(r["lat"]), "lon": float(r["lon"])})
                except (KeyError, ValueError):
                    pass
        (ROOT / "data" / "kendras.json").write_text(json.dumps({"meta": {"is_sample": False}, "kendras": rows}, indent=1))
        print(f"kendras:  {len(rows)} imported")


if __name__ == "__main__":
    main()
