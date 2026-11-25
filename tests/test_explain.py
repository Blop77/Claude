import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from explain import LANGS, MedicineInfo  # noqa: E402
from matcher import Catalog, parse_lines  # noqa: E402

INFO = MedicineInfo(json.loads((ROOT / "data" / "medicine_info.json").read_text()))
CATALOG = Catalog(json.loads((ROOT / "data" / "catalog.json").read_text()), INFO)
FIELDS = ("name", "uses", "how", "side_effects", "warning")


class Reference(unittest.TestCase):
    def test_every_entry_has_all_languages(self):
        for salt, entry in INFO.salts.items():
            for f in FIELDS:
                for lang in LANGS:
                    self.assertTrue(entry[f].get(lang), f"{salt}.{f}.{lang} missing")

    def test_every_catalog_salt_is_explained(self):
        for b in CATALOG.brands:
            for s in b["salts"]:
                self.assertIsNotNone(INFO.get(s["name"]), f"no explanation for {s['name']}")

    def test_unreviewed_notice_shown(self):
        res = CATALOG.analyse(parse_lines("Telma 40"))
        self.assertIsNotNone(res["info_notice"])


class Flow(unittest.TestCase):
    def test_brand_gets_explanation_and_schedule(self):
        row = CATALOG.analyse(parse_lines("Tab. Glycomet 500 mg 1-0-1 x 30 days"))["items"][0]
        self.assertEqual(row["schedule"], [1, 0, 1])
        self.assertEqual(row["days"], 30)
        self.assertEqual(row["explanations"][0]["salt"], "metformin")
        self.assertIn("hi", row["explanations"][0]["uses"])

    def test_combination_explains_each_salt(self):
        row = CATALOG.analyse(parse_lines("Augmentin 625 Duo 1-0-1 x 5 days"))["items"][0]
        self.assertEqual({e["salt"] for e in row["explanations"]}, {"amoxicillin", "clavulanic acid"})

    def test_generic_name_with_unit_is_priced_without_saving_claim(self):
        row = CATALOG.analyse(parse_lines("Tab Metformin 500 mg 1-0-1"))["items"][0]
        self.assertEqual(row["status"], "generic_named")
        self.assertIn("generic", row)
        self.assertNotIn("monthly_saving", row)

    def test_generic_name_without_unit_is_not_priced(self):
        # '50' could be mg or mcg: explain, but never price-match.
        row = CATALOG.analyse(parse_lines("Levothyroxine 50"))["items"][0]
        self.assertEqual(row["status"], "generic_named")
        self.assertNotIn("generic", row)
        self.assertEqual(row["explanations"][0]["salt"], "levothyroxine")

    def test_unknown_line_has_no_explanation(self):
        row = CATALOG.analyse(parse_lines("Review after 1 month"))["items"][0]
        self.assertNotIn("explanations", row)


if __name__ == "__main__":
    unittest.main()
