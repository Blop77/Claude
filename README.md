# SastiDawa — same salt, same strength, lower price

> For **families buying regular medicines** who need to **cut their monthly medicine bill**,
> SastiDawa shows **how much they can save** by **reading their prescription and matching each
> branded drug to a Jan Aushadhi generic with the same salt, strength and form, at the nearest Kendra**.

Built for the **Campus to Cloud Hackathon — Techfest, IIT Bombay (2026)**.

## Why

- Households paid **39.4% of India's total health expenditure** out of pocket in 2021-22
  (≈ ₹3.56 lakh crore; ₹2,600 per person) — National Health Accounts 2021-22, MoHFW.
- Jan Aushadhi medicines are priced **50–80% below** leading brands (Govt. reply in Parliament),
  and **17,990 Kendras** were open by 31 Dec 2025.
- The gap: people don't know *which* generic replaces the brand on their prescription.

## What it does (demo flow)

1. Upload a prescription photo (**Amazon Textract** reads it) or type medicines.
2. Review and correct what was read; dosage like `1-0-1 x 30 days` becomes a monthly quantity.
3. Each brand is matched to a Jan Aushadhi product with the **exact same salts, strengths and
   dosage form** (modified-release kept separate). No near-miss is ever substituted.
4. See monthly and yearly savings, find nearby Kendras, and share the list on WhatsApp or via a
   30-day link (**DynamoDB** with TTL).

## Architecture

```
Browser ── CloudFront ──┬── S3 (static site, private, OAC)
                        └── /api/* ── API Gateway (HTTP API, throttled) ── Lambda (Python 3.12)
                                                                          ├── Textract  (OCR)
                                                                          └── DynamoDB  (shared lists, TTL)
```

| AWS service | Used for |
|---|---|
| Amazon S3 + CloudFront | Hosting the site at one HTTPS URL, Indian edge locations |
| API Gateway HTTP API | Public API, rate-limited to protect the Free Tier |
| AWS Lambda | Prescription parsing, brand → generic matching, Kendra lookup |
| Amazon Textract | Reading printed prescriptions (`DetectDocumentText`) |
| Amazon DynamoDB | Shareable lists that auto-delete after 30 days |
| CloudWatch Logs | Function logs (7-day retention) |

## Data status — read this

The repo ships with **sample data** (`data/catalog.json`, `data/kendras.json`):
salt compositions are real, **all prices and Kendras are placeholders**, and the app shows a
banner saying so. Before the demo, import the official data:

```bash
python3 scripts/import_catalog.py --generics pmbjp_products.csv --brands brands.csv --kendras kendras.csv
```

See the docstring in `scripts/import_catalog.py` for the expected columns.

## Run locally

```bash
python3 scripts/dev_server.py          # http://localhost:8000  (photo OCR off locally)
python3 -m unittest discover -s tests  # matcher tests
```

## Deploy (your AWS account)

Prerequisites: AWS CLI v2, [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), `aws configure` done, and a **budget alarm** set.

```bash
./scripts/deploy.sh      # region defaults to ap-south-1 (Mumbai)
```

## Limitations (honest list)

- Handwritten prescriptions OCR poorly; typed entry and the review step cover this.
- Tablets and capsules only for now (no syrups/injections).
- Brand prices must come from a citable source; we don't scrape pharmacy sites.
- **Not medical advice.** Users are told to confirm any switch with their doctor or pharmacist.
