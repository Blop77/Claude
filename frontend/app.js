(() => {
  "use strict";
  const API = (window.API_BASE || "") + "/api";
  const $ = (id) => document.getElementById(id);
  const rupee = (n) => "₹" + (n < 10 ? (+n).toFixed(2) : Math.round(n).toLocaleString("en-IN"));
  const AUDIO_LANGS = ["en", "hi"]; // Amazon Polly has no Marathi voice

  let lang = loadLang();
  let last = null; // last analysis result
  let audio = null;

  const SAMPLE_RX = [
    "SAMPLE PRESCRIPTION (synthetic, for demo)",
    "Tab. Glycomet 500 mg 1-0-1 x 30 days",
    "Tab Telma 40 1-0-0 x 30 days",
    "Tab Atorva 10 0-0-1 x 30 days",
    "Tab. Ecosprin 75 0-1-0 x 30 days",
    "Tab Montair LC 0-0-1 x 10 days",
  ].join("\n");

  const t = (key, ...args) => {
    const v = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key];
    return typeof v === "function" ? v(...args) : v;
  };
  const pick = (obj) => (obj ? obj[lang] ?? obj.en : "");

  // ------------------------------------------------------------- language

  function loadLang() {
    try { return localStorage.getItem("medlens-lang") || "en"; } catch { return "en"; }
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem("medlens-lang", l); } catch { /* private mode */ }
    document.documentElement.lang = l;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === l));
    $("pincode").placeholder = t("pincode");
    stopAudio();
    if (last) render(last, false);
  }

  // ------------------------------------------------------------------ api

  function setStatus(msg, isError = false, el = $("status")) {
    el.textContent = msg;
    el.classList.toggle("error", isError);
  }

  async function call(path, opts = {}) {
    const res = await fetch(API + path, { headers: { "content-type": "application/json" }, ...opts });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function busy(on, msg) {
    document.querySelectorAll("main button").forEach((b) => (b.disabled = on));
    if (msg) setStatus(msg);
  }

  // ---------------------------------------------------------------- input

  async function analyseText(text) {
    if (!text.trim()) return setStatus(t("needInput"), true);
    busy(true, t("matching"));
    try { render(await call("/match", { method: "POST", body: JSON.stringify({ text }) })); setStatus(""); }
    catch (e) { setStatus(e.message, true); }
    finally { busy(false); }
  }

  async function analysePhoto(file) {
    if (!file) return;
    busy(true, t("reading"));
    try {
      const image_base64 = await downscale(file);
      const data = await call("/extract", { method: "POST", body: JSON.stringify({ image_base64 }) });
      if (data.ocr_text) $("rx-text").value = data.ocr_text;
      render(data);
      setStatus(t("readDone"));
    } catch (e) { setStatus(e.message, true); }
    finally { busy(false); $("photo").value = ""; }
  }

  // Shrink phone photos to <= 1600px JPEG so uploads stay small and fast.
  function downscale(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("That file is not an image we can read."));
      img.src = URL.createObjectURL(file);
    });
  }

  // --------------------------------------------------------------- render

  function render(data, scroll = true) {
    last = data;
    renderBanners(data);
    renderCards(data);
    renderFixList(data);
    renderSavings(data);
    $("step-explain").hidden = false;
    setStatus("", false, $("share-status"));
    if (scroll) $("step-explain").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderBanners(data) {
    const notes = [];
    if (data.info_notice) notes.push(pick(data.info_notice));
    if (data.is_sample_data) notes.push(data.data_notice);
    $("banners").innerHTML = notes.map((n) => `<div class="banner">${escapeHtml(n)}</div>`).join("");
  }

  function renderCards(data) {
    const box = $("med-cards");
    box.innerHTML = "";
    const known = data.items.filter((r) => r.explanations);
    const unknown = data.items.filter((r) => !r.explanations);
    for (const r of known) box.append(medCard(r));
    // Unrecognised lines are listed briefly, not hidden.
    for (const r of unknown) {
      const div = document.createElement("div");
      div.className = "med-card unknown";
      div.innerHTML = `<span class="pill bad">?</span> “${escapeHtml(r.raw)}” — ${escapeHtml(t("notRecognised"))}`;
      box.append(div);
    }
  }

  function medCard(r) {
    const card = document.createElement("article");
    card.className = "med-card";
    const title = r.brand ? r.brand.brand : r.explanations.map((e) => pick(e.name) || e.salt).join(" + ");
    const saltLine = r.explanations.map((e) => `${pick(e.name) || e.salt}${e.strength ? " " + e.strength : ""}`).join(" + ");
    let html = `<header><div><h3>${escapeHtml(title)}</h3><div class="salt">${escapeHtml(saltLine)}</div></div>`;
    if (AUDIO_LANGS.includes(lang)) html += `<button class="ghost small listen">${escapeHtml(t("listen"))}</button>`;
    html += `</header>`;
    html += scheduleHtml(r);
    for (const e of r.explanations) {
      if (r.explanations.length > 1) html += `<h4>${escapeHtml(pick(e.name) || e.salt)}</h4>`;
      if (!e.found) { html += `<p>${escapeHtml(t("noInfo"))}</p>`; continue; }
      html += `<dl>
        <dt>${escapeHtml(t("uses"))}</dt><dd>${escapeHtml(pick(e.uses))}</dd>
        <dt>${escapeHtml(t("how"))}</dt><dd>${escapeHtml(pick(e.how))}</dd>
        <dt>${escapeHtml(t("sideEffects"))}</dt><dd><ul>${(pick(e.side_effects) || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></dd>
        <dt class="warn">⚠ ${escapeHtml(t("warning"))}</dt><dd class="warn">${escapeHtml(pick(e.warning))}</dd>
      </dl>`;
    }
    card.innerHTML = html;
    const btn = card.querySelector(".listen");
    if (btn) btn.addEventListener("click", () => speak(btn, speechText(r, title)));
    return card;
  }

  function scheduleHtml(r) {
    let body;
    if (r.schedule) {
      const slots = [["🌅", t("morning")], ["☀️", t("afternoon")], ["🌙", t("night")]];
      body = `<div class="slots">${slots.map(([icon, label], i) =>
        `<div class="slot ${r.schedule[i] ? "on" : "off"}"><span>${icon}</span>${escapeHtml(label)}<b>${r.schedule[i]}</b></div>`).join("")}</div>`;
      if (r.days) body += `<div class="salt">${escapeHtml(t("forDays", r.days))}</div>`;
    } else {
      body = `<div class="salt">${escapeHtml(t("noSchedule"))}</div>`;
    }
    return `<div class="schedule"><div class="label">${escapeHtml(t("schedule"))}</div>${body}</div>`;
  }

  function speechText(r, title) {
    const parts = [title + "."];
    if (r.schedule) {
      const names = [t("morning"), t("afternoon"), t("night")];
      parts.push(r.schedule.map((n, i) => (n ? `${names[i]} ${n}` : "")).filter(Boolean).join(", ") + ".");
    }
    for (const e of r.explanations.filter((x) => x.found)) {
      parts.push(`${t("uses")}: ${pick(e.uses)}`, `${t("how")}: ${pick(e.how)}`,
        `${t("sideEffects")}: ${(pick(e.side_effects) || []).join(", ")}.`, `${t("warning")}: ${pick(e.warning)}`);
    }
    return parts.join(" ");
  }

  function renderFixList(data) {
    const box = $("fix-list");
    box.innerHTML = "";
    data.items.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "fix-row";
      row.dataset.index = i;
      row.innerHTML = `<input class="query" aria-label="Medicine name">
        <input class="qty" type="number" min="0" max="999" aria-label="Tablets per month">`;
      row.querySelector(".query").value = r.brand ? r.brand.brand : r.query;
      row.querySelector(".qty").value = r.units;
      box.append(row);
    });
  }

  function renderSavings(data) {
    const s = data.summary;
    const show = s.matched > 0;
    $("step-savings").hidden = !show;
    $("step-kendra").hidden = !show && !data.items.some((r) => r.generic);
    if (!show) return;
    $("s-brand").textContent = rupee(s.brand_monthly);
    $("s-generic").textContent = rupee(s.generic_monthly);
    $("save-line").innerHTML = t("saveLine", rupee(s.monthly_saving), rupee(s.yearly_saving), s.saving_pct, s.matched, s.total);
    const tbody = $("results").querySelector("tbody");
    tbody.innerHTML = "";
    for (const r of data.items.filter((x) => x.brand)) {
      const tr = document.createElement("tr");
      const eq = r.status === "matched"
        ? `<b>${escapeHtml(r.generic.name)}</b><div class="salt">${escapeHtml(t("perTen", rupee(r.generic_unit_price * 10), rupee(r.brand_unit_price * 10)))}</div><span class="pill">${escapeHtml(t("sameSalt"))}</span>`
        : `<span class="pill warn">${escapeHtml(t("noGeneric"))}</span>`;
      const save = r.status === "matched" ? `<span class="save">${rupee(r.monthly_saving)}</span><div class="salt">${r.saving_pct}%</div>` : "—";
      tr.innerHTML = `<td><b>${escapeHtml(r.brand.brand)}</b><div class="salt">× ${r.units}</div></td><td>${eq}</td><td class="num-col">${save}</td>`;
      tbody.append(tr);
    }
    $("btn-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(shareText(data));
  }

  function shareText(data) {
    const lines = ["Jan Aushadhi list (MedLens):"];
    for (const r of data.items) {
      if (r.status === "matched") lines.push(`• ${r.brand.brand} → ${r.generic.name}${r.generic.code ? " [" + r.generic.code + "]" : ""} × ${r.units}`);
    }
    lines.push(`Estimated saving: ${rupee(data.summary.monthly_saving)}/month.`);
    if (data.is_sample_data) lines.push("(Demo with SAMPLE prices.)");
    lines.push("Please confirm with the pharmacist.");
    return lines.join("\n");
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------------- audio

  async function speak(btn, text) {
    if (audio && btn.classList.contains("playing")) return stopAudio();
    stopAudio();
    btn.disabled = true;
    try {
      const { audio_base64 } = await call("/speak", { method: "POST", body: JSON.stringify({ text, lang }) });
      audio = new Audio("data:audio/mpeg;base64," + audio_base64);
      btn.classList.add("playing");
      btn.textContent = t("stop");
      audio.onended = stopAudio;
      await audio.play();
    } catch (e) {
      setStatus(e.message, true);
      $("step-input").scrollIntoView({ behavior: "smooth" });
    } finally { btn.disabled = false; }
  }

  function stopAudio() {
    if (audio) { audio.pause(); audio = null; }
    document.querySelectorAll(".listen.playing").forEach((b) => { b.classList.remove("playing"); b.textContent = t("listen"); });
  }

  // -------------------------------------------------------------- recheck

  async function recheck() {
    const items = [...$("fix-list").querySelectorAll(".fix-row")].map((row) => {
      const orig = last.items[row.dataset.index];
      return { raw: orig.raw, query: row.querySelector(".query").value.trim(),
        units: Number(row.querySelector(".qty").value) || 0, schedule: orig.schedule, days: orig.days };
    }).filter((i) => i.query);
    busy(true, t("matching"));
    try { render(await call("/match", { method: "POST", body: JSON.stringify({ items }) })); setStatus(""); }
    catch (e) { setStatus(e.message, true); }
    finally { busy(false); }
  }

  // ---------------------------------------------------------------- share

  async function share() {
    const el = $("share-status");
    try {
      const { id } = await call("/share", { method: "POST", body: JSON.stringify({ items: last.items, summary: last.summary }) });
      const url = `${location.origin}${location.pathname}?list=${id}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      setStatus(t("linkCopied", url), false, el);
    } catch (e) { setStatus(e.message, true, el); }
  }

  async function loadShared(id) {
    busy(true, t("matching"));
    try {
      const rec = await call("/share/" + encodeURIComponent(id));
      const items = rec.items.map((i) => ({ query: i.brand || i.query, units: i.units }));
      render(await call("/match", { method: "POST", body: JSON.stringify({ items }) }));
      setStatus("");
    } catch (e) { setStatus(e.message, true); }
    finally { busy(false); }
  }

  // -------------------------------------------------------------- kendras

  async function findKendras(query) {
    const list = $("kendra-list");
    list.innerHTML = `<li>${escapeHtml(t("searching"))}</li>`;
    try {
      const data = await call("/kendras?" + new URLSearchParams(query));
      if (!data.kendras.length) { list.innerHTML = `<li>${escapeHtml(t("noKendra"))}</li>`; return; }
      list.innerHTML = data.kendras.map((k) => `<li><b>${escapeHtml(k.name)}</b>
        ${k.distance_km != null ? ` · ${k.distance_km} km` : ""}<br>
        <span class="salt">${escapeHtml(k.address)}, ${escapeHtml(k.pincode)}</span>
        · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${k.lat},${k.lon}">${escapeHtml(t("directions"))}</a></li>`).join("")
        + (data.is_sample_data ? `<li class="salt">${escapeHtml(data.data_notice)}</li>` : "");
    } catch (e) { list.innerHTML = `<li class="status error">${escapeHtml(e.message)}</li>`; }
  }

  // --------------------------------------------------------------- wiring

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  $("btn-text").addEventListener("click", () => analyseText($("rx-text").value));
  $("btn-sample").addEventListener("click", () => { $("rx-text").value = SAMPLE_RX; analyseText(SAMPLE_RX); });
  $("photo").addEventListener("change", (e) => analysePhoto(e.target.files[0]));
  $("btn-recheck").addEventListener("click", recheck);
  $("btn-share").addEventListener("click", share);
  $("btn-pin").addEventListener("click", () => findKendras({ pincode: $("pincode").value.trim() }));
  $("pincode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-pin").click(); });
  $("btn-loc").addEventListener("click", () => {
    if (!navigator.geolocation) return findKendras({});
    navigator.geolocation.getCurrentPosition(
      (p) => findKendras({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { $("kendra-list").innerHTML = `<li>${escapeHtml(t("locDenied"))}</li>`; },
    );
  });

  setLang(lang);
  const shared = new URLSearchParams(location.search).get("list");
  if (shared) loadShared(shared);
})();
