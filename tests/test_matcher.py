import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from matcher import Catalog, parse_lines, strength_to_mg, salt_key  # noqa: E402

CATALOG = Catalog(json.loads((ROOT / "data" / "catalog.json").read_text()))  # no explanations

SAMPLE_RX = """Dr. Sample Clinic
Patient: SAMPLE PATIENT
Tab. Glycomet 500 mg 1-0-1 x 30 days
Tab Telma 40 1-0-0 x 30 days
Tab. Ecosprin 75 0-1-0 x 30 days
Tab Montair LC 0-0-1 x 10 days
Review after 1 month
"""


class Strength(unittest.TestCase):
    def test_units(self):
        self.assertEqual(strength_to_mg("500 mg"), 500)
        self.assertEqual(strength_to_mg("0.5g"), 500)
        self.assertEqual(strength_to_mg("50 mcg"), 0.05)

    def test_salt_key_order_independent(self):
        a = [{"name": "Metformin", "strength": "500 mg"}, {"name": "glimepiride", "strength": "1mg"}]
        b = list(reversed(a))
        self.assertEqual(salt_key(a), salt_key(b))

    def test_salt_forms_normalised(self):
        a = [{"name": "Metformin Hydrochloride IP", "strength": "500mg"}]
        b = [{"name": "metformin", "strength": "500 mg"}]
        self.assertEqual(salt_key(a), salt_key(b))
        c = [{"name": "Amoxycillin", "strength": "500 mg"}, {"name": "Potassium Clavulanate", "strength": "125 mg"}]
        d = [{"name": "amoxicillin", "strength": "500 mg"}, {"name": "clavulanic acid", "strength": "125 mg"}]
        self.assertEqual(salt_key(c), salt_key(d))


class Parsing(unittest.TestCase):
    def test_dosage_and_duration(self):
        items = parse_lines("Tab. Glycomet 500 mg 1-0-1 x 30 days")
        self.assertEqual(items[0]["units"], 60)
        self.assertNotIn("30", items[0]["query"].split())

    def test_short_course(self):
        items = parse_lines("Tab Montair LC 0-0-1 x 10 days")
        self.assertEqual(items[0]["units"], 10)

    def test_default_units(self):
        self.assertEqual(parse_lines("Pan 40")[0]["units"], 30)


class Matching(unittest.TestCase):
    def test_exact_brand(self):
        brand, _ = CATALOG.match_brand("glycomet 500 mg")
        self.assertEqual(brand["brand"], "Glycomet 500")

    def test_ocr_typo(self):
        brand, _ = CATALOG.match_brand("glycomt 500")
        self.assertEqual(brand["brand"], "Glycomet 500")

    def test_wrong_strength_is_not_matched(self):
        brand, _ = CATALOG.match_brand("telma 80")
        self.assertIsNone(brand)

    def test_unknown_word(self):
        brand, _ = CATALOG.match_brand("review after")
        self.assertIsNone(brand)

    def test_combination_generic_requires_all_salts(self):
        brand, _ = CATALOG.match_brand("augmentin 625 duo")
        g = CATALOG.find_generic(brand["salts"], brand["form"])
        self.assertEqual(salt_key(g["salts"]), salt_key(brand["salts"]))

    def test_full_prescription(self):
        res = CATALOG.analyse(parse_lines(SAMPLE_RX))
        by_brand = {r["brand"]["brand"]: r for r in res["items"] if r.get("brand")}
        self.assertEqual(by_brand["Glycomet 500"]["status"], "matched")
        self.assertEqual(by_brand["Montair LC"]["status"], "no_generic")
        self.assertGreater(res["summary"]["monthly_saving"], 0)
        self.assertTrue(res["is_sample_data"])
        # Header / footer lines must not match anything.
        statuses = {r["raw"]: r["status"] for r in res["items"]}
        self.assertEqual(statuses["Review after 1 month"], "no_match")
        self.assertEqual(statuses["Dr. Sample Clinic"], "no_match")



class NumberedLines(unittest.TestCase):
    """Printed prescriptions number their lines; '2.' must not be read as 2 mg."""

    def test_numbered_lines_match(self):
        rx = "1. Tab Glycomet 500 mg 1-0-1 x 30 days\n2. Tab Telma 40 1-0-0 x 30 days\n3) Tab Atorva 10 0-0-1"
        res = CATALOG.analyse(parse_lines(rx))
        self.assertEqual([r["brand"]["brand"] for r in res["items"]], ["Glycomet 500", "Telma 40", "Atorva 10"])

    def test_strength_not_stripped(self):
        self.assertIn("40", parse_lines("Telma 40")[0]["query"].split())


if __name__ == "__main__":
    unittest.main()
