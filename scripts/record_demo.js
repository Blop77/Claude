/*
 * Records the MedLens demo video by driving the LIVE app in a real browser.
 * Nothing is mocked: every screen is the deployed site.
 *
 *   npm i playwright@1 && npx playwright install chromium   (once)
 *   node scripts/record_demo.js [APP_URL] [OUT_DIR]
 *
 * Output: OUT_DIR/medlens-demo.mp4 (needs ffmpeg) + medlens-demo.srt (captions).
 * Real Amazon Polly audio from the "Listen" tap is mixed into the video.
 * Optional: TESS_LOCAL=<dir with node_modules> serves Tesseract.js from local npm
 * packages instead of the jsDelivr CDN (for networks that block the CDN).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const APP = (process.argv[2] || "https://d13yy3mzvdlmrz.cloudfront.net").replace(/\/$/, "");
const OUT = path.resolve(process.argv[3] || "demo-out");
const RX_IMG = path.join(__dirname, "..", "docs", "demo", "sample-prescription.jpg");
const TEAM = "Team Nebula Nomads — Ishaan Singh · Akanksha Singh · Faaz Khan · Arnav Mankawade";
const W = 1280, H = 720;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const captions = []; // {start, end, text}
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;

const OVERLAY_CSS = `
  #demo-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1000px;z-index:99999;
    background:rgba(10,20,16,.88);color:#fff;font:600 24px/1.35 system-ui,sans-serif;padding:12px 22px;border-radius:12px;
    text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35);transition:opacity .25s}
  #demo-cur{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:99998;pointer-events:none;
    background:rgba(255,196,0,.55);border:3px solid #ffb300;transition:left .6s ease,top .6s ease,transform .15s;left:640px;top:360px;opacity:0}
  #demo-cur.tap{transform:scale(.6)}`;

async function overlay(page) {
  await page.evaluate((css) => {
    if (document.getElementById("demo-cap")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const c = document.createElement("div"); c.id = "demo-cap"; c.style.opacity = 0; document.body.append(c);
    const k = document.createElement("div"); k.id = "demo-cur"; document.body.append(k);
  }, OVERLAY_CSS);
}

let capOpen = null;
async function caption(page, text) {
  await overlay(page);
  if (capOpen) { capOpen.end = now(); }
  await page.evaluate((t) => { const c = document.getElementById("demo-cap"); c.textContent = t; c.style.opacity = t ? 1 : 0; }, text);
  capOpen = text ? { start: now(), end: null, text } : null;
  if (capOpen) captions.push(capOpen);
}

async function tap(page, selector) {
  await overlay(page);
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.evaluate(([x, y]) => { const k = document.getElementById("demo-cur"); k.style.opacity = 1; k.style.left = x + "px"; k.style.top = y + "px"; },
    [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(700);
  await page.evaluate(() => document.getElementById("demo-cur").classList.add("tap"));
  await sleep(150);
  await page.evaluate(() => document.getElementById("demo-cur").classList.remove("tap"));
  return el;
}

async function scrollTo(page, selector, offset = 90) {
  await page.evaluate(([s, o]) => {
    const el = document.querySelector(s);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: "smooth" });
  }, [selector, offset]);
  await sleep(1100);
}

function card(title, sub, extra = "") {
  return `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-content:center;text-align:center;
    background:#0f7a4f;color:#fff;font-family:system-ui,sans-serif">
    <div style="font-size:72px;font-weight:800;letter-spacing:-1px">Med<span style="font-weight:400">Lens</span></div>
    <div style="font-size:30px;margin-top:10px;opacity:.95">${title}</div>
    <div style="font-size:22px;margin-top:22px;opacity:.85">${sub}</div>${extra}</body></html>`;
}

const ARCH_HTML = (onDevice, sample) => {
  const box = (t, sub, c = "#0f7a4f") => `<div style="border:2px solid ${c};border-radius:14px;padding:14px 18px;background:#fff;min-width:170px">
    <div style="font-weight:700;color:${c};font-size:22px">${t}</div><div style="color:#4a5a53;font-size:16px;margin-top:4px">${sub}</div></div>`;
  const arrow = `<div style="font-size:30px;color:#7a8a83">→</div>`;
  return `<!doctype html><html><body style="margin:0;height:100vh;background:#f6f8f7;font-family:system-ui,sans-serif;display:grid;place-content:center;gap:28px">
    <div style="text-align:center;font-size:34px;font-weight:800;color:#14211c">How MedLens runs on AWS</div>
    <div style="display:flex;align-items:center;gap:16px;justify-content:center">
      ${box("Phone", "web app, 3 languages", "#14211c")}${arrow}${box("CloudFront + S3", "HTTPS website")}${arrow}
      ${box("API Gateway", "rate-limited API")}${arrow}${box("AWS Lambda", "Python: parse, explain, match")}</div>
    <div style="display:flex;gap:16px;justify-content:center">
      ${box("Amazon Polly", "Hindi / English audio")}
      ${box("Amazon Textract", onDevice ? "photo → text (activation pending)" : "photo → text", onDevice ? "#9a6b00" : "#0f7a4f")}
      ${box("Amazon DynamoDB", "share links, 30-day TTL")}</div>
    <div style="text-align:center;color:#4a5a53;font-size:18px">Medicine explanations: fixed reference file &nbsp;·&nbsp; Prices: Jan Aushadhi product list${sample ? " (sample values in this recording)" : ""} &nbsp;·&nbsp; One SAM template</div>
  </body></html>`;
};

function routeTesseract(context) {
  const dir = process.env.TESS_LOCAL;
  if (!dir) return;
  const NM = path.join(dir, "node_modules");
  return context.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = new URL(r.request().url()).pathname; let m, f = null;
    if ((m = u.match(/^\/npm\/tesseract\.js@v?[\d.]+\/dist\/(.+)$/))) f = path.join(NM, "tesseract.js/dist", m[1]);
    else if ((m = u.match(/^\/npm\/tesseract\.js-core@v?[\d.]+\/(.+)$/))) f = path.join(NM, "tesseract.js-core", m[1]);
    else if ((m = u.match(/^\/npm\/@tesseract\.js-data\/eng\/(.+)$/))) f = path.join(NM, "@tesseract.js-data/eng", m[1]);
    if (!f || !fs.existsSync(f)) return r.continue();
    const type = f.endsWith(".wasm") ? "application/wasm" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream";
    r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": type, "access-control-allow-origin": "*" } });
  });
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await routeTesseract(context);
  const page = await context.newPage();
  t0 = Date.now();
  const audioClips = []; // {at, file}
  page.on("response", async (res) => {
    if (!res.url().endsWith("/api/speak") || !res.ok()) return;
    try {
      const { audio_base64 } = await res.json();
      const file = path.join(OUT, `speak-${audioClips.length}.mp3`);
      fs.writeFileSync(file, Buffer.from(audio_base64, "base64"));
      audioClips.push({ at: now(), file });
    } catch { /* ignore */ }
  });

  // 1. Title
  await page.setContent(card("Understand your prescription in your own language", "Campus to Cloud Hackathon · Techfest, IIT Bombay"));
  await sleep(4500);

  // 2. The problem: a printed English prescription
  const img = fs.readFileSync(RX_IMG).toString("base64");
  await page.setContent(`<body style="margin:0;background:#222;display:grid;place-items:center;height:100vh">
    <img src="data:image/jpeg;base64,${img}" style="max-height:600px;box-shadow:0 10px 40px #000"></body>`);
  await caption(page, "A prescription like this is in English and medical shorthand: “1-0-1”, “Tab”, brand names.");
  await sleep(5000);
  await caption(page, "For millions of people who read Hindi or Marathi, it might as well be in code.");
  await sleep(4500);

  // 3. App home -> Hindi -> photo
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await caption(page, "MedLens: a web app on AWS. Pick your language…");
  await sleep(1500);
  await (await tap(page, "[data-lang=hi]")).click();
  await sleep(1800);
  await caption(page, "…and take a photo of the prescription.");
  await tap(page, "label.upload");
  await page.setInputFiles("#photo", RX_IMG);
  await page.waitForSelector("#step-explain:not([hidden])", { timeout: 90000 });
  await sleep(800);
  const status = (await page.textContent("#status")) || "";
  const onDevice = /फ़ोन|device|फोन/.test(status) || status.includes("इसी");
  console.log("photo status:", status.trim(), onDevice ? "(on-device OCR)" : "(Textract)");

  // 4. Cards in Hindi
  await scrollTo(page, "#step-explain");
  await caption(page, "Every medicine is explained in simple Hindi: what it’s for, when to take it, what to watch for.");
  await sleep(4000);
  await scrollTo(page, ".med-card .schedule");
  await caption(page, "“1-0-1 for 30 days” becomes a morning / afternoon / night chart.");
  await sleep(4000);
  await scrollTo(page, ".med-card dl", 140);
  await caption(page, "Side effects and one key warning — from a fixed medicine reference, not AI-generated text.");
  await sleep(4500);

  // 5. Listen (real Amazon Polly audio)
  await scrollTo(page, ".med-card");
  await caption(page, "🔊 Tap “सुनें” — Amazon Polly reads it aloud, for people who find reading hard.");
  await (await tap(page, ".med-card .listen")).click();
  await sleep(9000);
  await page.evaluate(() => document.querySelector(".listen.playing")?.click());

  // 6. Marathi
  await caption(page, "Marathi too.");
  await scrollTo(page, ".top", 0);
  await (await tap(page, "[data-lang=mr]")).click();
  await sleep(1000);
  await scrollTo(page, "#step-explain");
  await sleep(3000);

  // 7. Unknown line handled honestly
  await scrollTo(page, ".med-card.unknown", 260);
  await caption(page, "If MedLens can’t recognise a line, it says “ask your pharmacist” — it never guesses.");
  await sleep(4500);

  // 8. Savings (English for judges)
  await scrollTo(page, ".top", 0);
  await (await tap(page, "[data-lang=en]")).click();
  await sleep(800);
  await scrollTo(page, "#step-savings");
  const sample = await page.evaluate(() => document.querySelector("#banners")?.textContent.includes("SAMPLE"));
  await caption(page, "Then it finds the Jan Aushadhi medicine with the exact same salt, strength and form…");
  await sleep(4500);
  await caption(page, sample ? "…and shows the monthly saving (prices in this recording are sample placeholders)."
    : "…and shows how much the family saves every month.");
  await sleep(4500);

  // 9. Kendra + share
  await scrollTo(page, "#step-kendra");
  await caption(page, "Find the nearest Jan Aushadhi Kendra, and share the list on WhatsApp to show at the counter.");
  await (await tap(page, "#pincode")).click();
  await page.keyboard.type("411038", { delay: 120 });
  await (await tap(page, "#btn-pin")).click();
  await sleep(3500);

  // 10. Architecture (own card, so no draft text from other pages appears)
  await caption(page, "");
  await page.setContent(ARCH_HTML(onDevice, sample));
  await caption(page, "Built on AWS: CloudFront, S3, API Gateway, Lambda, Amazon Polly and DynamoDB, on the Free Tier.");
  await sleep(6000);
  if (onDevice) {
    await caption(page, "Photo reading uses Amazon Textract; until it is enabled on our account, it runs on the phone.");
    await sleep(5000);
  }

  // 11. End card
  await caption(page, "");
  await page.setContent(card("Same medicine. Your language. Lower price.", TEAM,
    `<div style="font-size:22px;margin-top:26px;background:#fff;color:#0f7a4f;padding:10px 18px;border-radius:10px;display:inline-block">${APP.replace("https://", "")}</div>`));
  await sleep(5000);
  if (capOpen) capOpen.end = now();

  const total = now();
  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();

  // Captions file (SRT) — burned in already; upload to YouTube as subtitles too.
  const fmt = (s) => { const ms = Math.round(s * 1000); const h = String(Math.floor(ms / 3.6e6)).padStart(2, "0");
    const m = String(Math.floor(ms / 6e4) % 60).padStart(2, "0"); const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    return `${h}:${m}:${ss},${String(ms % 1000).padStart(3, "0")}`; };
  fs.writeFileSync(path.join(OUT, "medlens-demo.srt"),
    captions.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end ?? total)}\n${c.text}\n`).join("\n"));

  // MP4 with the real Polly audio placed where "Listen" was tapped.
  const mp4 = path.join(OUT, "medlens-demo.mp4");
  const args = ["-y", "-loglevel", "error", "-i", webm];
  audioClips.forEach((c) => args.push("-i", c.file));
  if (audioClips.length) {
    const delays = audioClips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[a${i}]`).join(";");
    const mix = audioClips.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${audioClips.length}:normalize=0[aout]`;
    args.push("-filter_complex", `${delays};${mix}`, "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium", "-movflags", "+faststart", "-t", String(total), mp4);
  execFileSync("ffmpeg", args);
  fs.rmSync(webm);
  audioClips.forEach((c) => fs.rmSync(c.file));
  console.log(`done: ${mp4} (${total.toFixed(1)} s, ${audioClips.length} audio clip(s)) + medlens-demo.srt`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
