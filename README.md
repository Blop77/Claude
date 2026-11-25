# MedLens — understand your prescription in your own language

> For **patients who read Hindi or Marathi better than English**, MedLens **explains every medicine
> on their prescription in simple words** — what it's for, when to take it, what to watch for — and
> shows **cheaper Jan Aushadhi equivalents with the same salt and strength**.

Built for the **Campus to Cloud Hackathon — Techfest, IIT Bombay (2026)**.

## Why

- Prescriptions are written in English and medical shorthand (`1-0-1`, `BD`); many patients depend
  on a pharmacist or relative to understand them. [TODO: add a sourced statistic or a real story]

- Households paid **39.4% of India's total health expenditure** out of pocket in 2021-22
  (≈ ₹3.56 lakh crore; ₹2,600 per person) — National Health Accounts 2021-22, MoHFW.
- Jan Aushadhi medicines are priced **50–80% below** leading brands (Govt. reply in Parliament),
  and **17,990 Kendras** were open by 31 Dec 2025.
- The gap: people don't know *which* generic replaces the brand on their prescription.

## What it does (demo flow)

1. Upload a prescription photo (**Amazon Textract** reads it) or type medicines.
2. Each medicine is explained in **English, Hindi or Marathi**: what it's for, how to take it,
   common side effects, and one key warning; `1-0-1 x 30 days` becomes a morning/afternoon/night
   chart. **Amazon Polly** reads it aloud in Hindi or English.
   Explanations come from a fixed reference file (`data/medicine_info.json`), not a generative model.
3. Each brand is matched to a Jan Aushadhi product with the **exact same salts, strengths and
   dosage form** (modified-release kept separate). No near-miss is ever substituted.
4. Users can correct what was read. See monthly and yearly savings, find nearby Kendras, and share the list on WhatsApp or via a
   30-day link (**DynamoDB** with TTL).

## Architecture

```
Browser ── CloudFront ──┬── S3 (static site, private, OAC)
                        └── /api/* ── API Gateway (HTTP API, throttled) ── Lambda (Python 3.12)
                                                                          ├── Textract  (OCR)
                                                                          ├── Polly     (Hindi/English audio)
                                                                          └── DynamoDB  (shared lists, TTL)
```

| AWS service | Used for |
|---|---|
| Amazon S3 + CloudFront | Hosting the site at one HTTPS URL, Indian edge locations |
| API Gateway HTTP API | Public API, rate-limited to protect the Free Tier |
| AWS Lambda | Prescription parsing, brand → generic matching, Kendra lookup |
| Amazon Textract | Reading printed prescriptions (`DetectDocumentText`) |
| Amazon Polly | Reading explanations aloud (neural voice, hi-IN / en-IN) |
| Amazon DynamoDB | Shareable lists that auto-delete after 30 days |
| CloudWatch Logs | Function logs (7-day retention) |

## Data status — read this

**Medicine explanations** (`data/medicine_info.json`, 14 ingredients) are a draft written for the
demo and **not yet reviewed by a pharmacist**; Hindi and Marathi need a native-speaker check. The app
shows a banner until `meta.reviewed` is set to `true`.

The repo ships with **sample price data** (`data/catalog.json`, `data/kendras.json`):
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
- Only 14 ingredients are explained so far; others show "ask your pharmacist".
- No Marathi audio: Amazon Polly has no Marathi voice.
- Brand prices must come from a citable source; we don't scrape pharmacy sites.
- **Not medical advice.** Users are told to confirm any switch with their doctor or pharmacist.
