# MedLens — Round 1 submission draft (Campus to Cloud, Techfest IIT Bombay)

Adapted from our original MedLens writeup. Every claim below must match the deployed app.
`[TODO]` = we must fill it with a real fact; never invent one.

**Team:** Nebula Nomads (TM-9890B209505) — Ishaan Singh, Akanksha Singh, Faaz Khan, Arnav Mankawade

**Tagline:** Understand your prescription in your own language.

---

## 1. Idea brief

### Problem
A patient leaves a clinic with a prescription in English and medical shorthand (`Tab Telma 40 1-0-0`).
If they read only Hindi or Marathi, they depend on a pharmacist or relative to know what each medicine
is for and when to take it. They also usually buy the branded medicine written on the slip, even when
a Jan Aushadhi generic with the same salt is far cheaper.
[TODO: add a sourced statistic or a real story from the team]

- Households paid 39.4% of India's total health expenditure out of pocket in 2021-22 (National Health Accounts 2021-22, MoHFW).
- Jan Aushadhi medicines are priced 50–80% below leading brands, and 17,990 Kendras were open by 31 Dec 2025 (Government replies in Parliament).

### Who it's for
Patients and caregivers who are more comfortable in Hindi or Marathi than in English, especially
people on long-term medicines (diabetes, blood pressure, thyroid, cholesterol).

### Solution
Take a photo of a prescription. MedLens reads it and, for each medicine, explains in simple
English, Hindi or Marathi:
- what it's for, how to take it, common side effects and one key warning;
- when to take it, turning `1-0-1 x 30 days` into a morning / afternoon / night chart;
- read aloud in Hindi or English, for people who find reading hard.

It then shows the Jan Aushadhi medicine with the **same salt, strength and form**, the monthly saving,
and the nearest Kendra, with a WhatsApp list to show at the counter.

MedLens explains; it doesn't replace a doctor or pharmacist, and the app says so on every screen.

### Why it's trustworthy
- Explanations come from a fixed reference written for each ingredient and [TODO: reviewed by
  pharmacist NAME / not yet reviewed]. **No AI-generated medical text.**
- Generic matching is exact (all salts, strengths, dosage form); sustained-release is never swapped
  for normal release; anything uncertain is shown as "ask your pharmacist", never guessed.
- Prescription photos are processed in memory and not stored.

---

## 2. Build summary

| AWS service | What it does in MedLens |
|---|---|
| Amazon Textract | Reads printed prescription photos (`DetectDocumentText`). Fallback: on-device Tesseract.js, labelled in the app. [TODO: confirm Textract is enabled on our account before submitting] |
| AWS Lambda (Python 3.12) | Parses medicines and dosage, looks up explanations, matches Jan Aushadhi generics, finds Kendras |
| Amazon Polly | Reads explanations aloud (neural voice, Hindi and Indian English) |
| Amazon API Gateway (HTTP API) | Public API with rate limiting to stay inside the Free Tier |
| Amazon DynamoDB | Shareable medicine lists that auto-delete after 30 days (TTL) |
| Amazon S3 + CloudFront | Hosts the mobile-friendly web app at one HTTPS URL |
| CloudWatch Logs | Function logs, 7-day retention |

Infrastructure as code: one AWS SAM template (`infra/template.yaml`). Stack region: [TODO: eu-north-1 now — move to ap-south-1 Mumbai?]; Textract and Polly are called in ap-south-1.
Region, budget alarm and Free Tier usage: [TODO: confirm after deploy].

**What is live vs. limited**
- Live: photo → OCR → medicine identification → explanation in 3 languages → audio → generic match → savings → Kendras → share.
- Limited: [TODO: number] medicines explained; tablets/capsules only; handwriting reads poorly
  (users can type or correct); no Marathi audio (Polly has no Marathi voice).
- Data: generic prices from the official PMBJP product list [TODO: confirm imported]; brand MRPs from [TODO: source].

**What's next:** more medicines and languages, dosage reminders from the parsed schedule, pharmacist
review workflow, [TODO: testing with real users or pharmacists, if planned].

**Links:** Live app: [TODO] · Repo: [TODO] · Video: [TODO]

---

## 3. Demo video script (under 3:00)

Use a **printed, synthetic** prescription. Never show a real patient's prescription.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:15 | Close-up of a printed English prescription with `1-0-1` shorthand | "For millions of people who read Hindi or Marathi, a prescription like this might as well be in code." |
| 0:15–0:25 | MedLens home screen, tap **हिन्दी** | "MedLens explains your prescription in your own language." |
| 0:25–0:40 | Take a photo → "Reading your prescription…" | "Just take a photo. Amazon Textract reads it." |
| 0:40–1:20 | Medicine cards in Hindi: schedule chart, uses, side effects, warning; tap **🔊 सुनें** | "Each medicine: what it's for, when to take it, what to watch for — and Amazon Polly reads it aloud." |
| 1:20–1:30 | Switch to **मराठी** | "Marathi too." |
| 1:30–2:05 | Savings section: branded vs Jan Aushadhi, monthly saving; Kendra by pincode; WhatsApp list | "Then MedLens finds the Jan Aushadhi medicine with the exact same salt and strength — here that's [TODO: real saving from real data] a month — and the nearest Kendra." |
| 2:05–2:30 | Architecture diagram: Phone → CloudFront → API Gateway → Lambda → Textract / Polly / DynamoDB | "All on AWS: serverless, inside the Free Tier." [TODO: say "Mumbai region" only if the stack is moved there] |
| 2:30–2:45 | Disclaimer + "ask your pharmacist" state for an unknown medicine | "When we're not sure, we say so. MedLens never guesses." |
| 2:45–2:55 | Team names, live URL | "MedLens. Built by Team Nebula Nomads — Ishaan Singh, Akanksha Singh, Faaz Khan and Arnav Mankawade." |

---

## 4. Finals: 3-min live demo + 2-min Q&A — likely questions

| Question | Honest answer |
|---|---|
| What if the OCR is wrong? | Users see and can correct every line before trusting it; unknown lines say "ask your pharmacist". |
| Why not use an LLM? | A model can invent side effects; medical text must come from a reviewed source. We use AWS for reading (Textract) and speech (Polly), not for medical content. |
| Is switching to a generic safe? | Same salt, strength and form only; we tell users to confirm with the pharmacist. |
| Handwriting? | Works poorly today; printed and e-prescriptions are growing; typed entry is the fallback. |
| Cost to run? | [TODO: real numbers from the AWS bill / Free Tier page] |
