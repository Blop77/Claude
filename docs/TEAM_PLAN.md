# MedLens — team plan (Campus to Cloud, Techfest IIT Bombay)

**Team Nebula Nomads (TM-9890B209505).** **Round 1 deadline: Sun 30 Nov 2026, 11:59 PM IST. We submit by 6 PM.**
Only the **Team Leader** can submit. Prototype URL must stay live until **17 Dec**.

## Roles and file ownership

Each person owns their files. Touch someone else's files only after asking them.
One integrator (A) merges to `main`.

| | Role | Owns | Main job |
|---|---|---|---|
| **A — Ishaan** | Team Leader + Cloud | `infra/`, `scripts/deploy.sh`, `main` branch | AWS account, deploy, integrate, submit |
| **B — Akanksha** | Data + medical review | `data/`, `scripts/import_catalog.py` | Official Jan Aushadhi list, brands with cited MRPs, Kendra list; **get a pharmacist to review `medicine_info.json`** |
| **C — Faaz** | Backend + OCR | `backend/`, `tests/` | Real-prescription OCR testing, parser fixes, tests |
| **D — Arnav** | Frontend + Pitch | `frontend/`, `docs/SUBMISSION.md` | UI polish, **Hindi/Marathi wording check** (`frontend/i18n.js` + `medicine_info.json`), video, idea brief, build summary |

Workflow: each person works on their own branch (`data-…`, `ocr-…`, `ui-…`), pushes,
and A merges. Run `python3 -m unittest discover -s tests` before pushing.

## Schedule

| When | A — Ishaan (Cloud) | B — Akanksha (Data) | C — Faaz (Backend/OCR) | D — Arnav (Frontend/Pitch) |
|---|---|---|---|---|
| **Tue 25** | Register team on techfest.org; create AWS account + budget alarm | Download PMBJP product list → CSV | Run app locally; write 8–10 **synthetic** printed prescriptions | Run app locally; list UI issues |
| **Wed 26** | Install AWS CLI + SAM; **first deploy** with sample data | Fill `brands_template.csv` (MRP + source); run importer | Read skipped-rows list from importer; fix parser cases | Polish UI, loading states, logo |
| **Thu 27** ★ live URL | Redeploy with real data; share URL with team | Kendra list for demo city (Pune/Mumbai) | Test OCR on live URL with the synthetic prescriptions | Draft idea brief + video script |
| **Fri 28** | Monitoring, budget check, fix deploy issues | Expand to 50+ brands; double-check 10 matches by hand | Fix OCR misses; add tests for each | Add 10 more medicines to `medicine_info.json` (only if all above done) |
| **Sat 29** 12:00 **FREEZE** | Final deploy; tag `v1-round1` | Data sanity pass | Bug fixes only | Record demo video (≤ 3 min) |
| **Sun 30** | **Submit by 18:00** (brief, build summary, repo, video, URL) | Proof-read brief | Repo README check | Upload video (unlisted YouTube/Drive), test link in incognito |

Everyone: create an **AWS Builder Center** account and verify student status (rule 5) by **Thu 27**.

## A (Ishaan) — AWS account setup (do today)

1. Sign up at aws.amazon.com with a **team email** (not a personal one you'll lose).
   Pick the **Free plan**. You need a debit/credit card with **international transactions enabled**
   (a small verification charge is refunded) and a phone number.
2. Sign in as root → turn on **MFA** (Google Authenticator) → never use root for daily work again.
3. **Billing → Budgets → Create budget → "Zero spend budget"** template, alerts to the team email.
   Also check **Billing → Free Tier** for remaining credits.
4. **IAM → Users → create `deployer`** (attach `AdministratorAccess` for the hackathon), enable MFA,
   create an **access key** for CLI use. Keep keys **out of git, chat and screenshots**.
5. Set region to **Asia Pacific (Mumbai) ap-south-1** (top-right).
6. On your laptop: install **AWS CLI v2** and **SAM CLI**, then `aws configure`
   (paste key, region `ap-south-1`, output `json`). Check with `aws sts get-caller-identity`.
7. Ask on the **Techfest Doubt section**: "Do services paid from AWS Free plan credits
   (e.g. Amazon Textract) count as Free Tier for rule 6?" Save the answer.
8. `./scripts/deploy.sh` → open the printed URL → run the sample prescription.

## B (Akanksha) — Data rules

- Generic prices **only** from the official PMBJP product list. Keep the downloaded file in `data/raw/` (git-ignored).
- Brand MRPs: from the **printed pack** or a source you can cite; put it in the `source` column.
  No made-up prices. Empty MRP = row skipped.
- Prefer chronic-illness medicines (diabetes, BP, thyroid, cholesterol, heart, acidity) — that's
  where monthly savings matter.

## C (Faaz) — OCR test rules

- Use **synthetic** prescriptions only (made-up names, typed in Word/Docs, printed and photographed).
  Never a real patient's prescription in the repo or the demo.
- For every OCR miss: add the line to a test in `tests/test_matcher.py`, then fix.

## Judging map (check on Fri 28)

| What the brief rewards | What in our demo proves it | Owner |
|---|---|---|
| Real problem for Indian users | Hindi/Marathi explanation of an English prescription; savings card in ₹ | D |
| Practical, working solution | Live URL; photo → savings in < 20 s | A, C |
| Effective use of AWS | Textract + Polly (Hindi audio) + Lambda + DynamoDB TTL + CloudFront; architecture slide | A |
| Trust / responsibility | Explanations from a fixed reviewed reference (no AI-generated medical text), exact salt match, MR separation, disclaimer | B, C |
| Impact / scale | 17,990 Kendras; WhatsApp share to use at the counter | D |

## D (Arnav) — Demo video

`scripts/record_demo.js` records the video automatically from the **live** site (captions burned in,
real Amazon Polly audio mixed in, ~1:40). Re-record after every important change — especially after
Akanksha's real-data import, so the "sample placeholders" captions disappear.

```bash
npm i playwright@1 && npx playwright install chromium     # once; also needs ffmpeg
node scripts/record_demo.js https://d13yy3mzvdlmrz.cloudfront.net demo-out
```
Upload `demo-out/medlens-demo.mp4` to YouTube as **Unlisted**, add `medlens-demo.srt` as subtitles,
open the link in an incognito window, then put the link on the submission page.
