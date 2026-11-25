(() => {
  "use strict";
  const API = (window.API_BASE || "") + "/api";
  const $ = (id) => document.getElementById(id);
  const rupee = (n) => "₹" + (n < 10 ? (+n).toFixed(2) : Math.round(n).toLocaleString("en-IN"));
  let last = null; // last analysis result

  const SAMPLE_RX = [
    "SAMPLE PRESCRIPTION (synthetic, for demo)",
    "Tab. Glycomet 500 mg 1-0-1 x 30 days",
    "Tab Telma 40 1-0-0 x 30 days",
    "Tab Atorva 10 0-0-1 x 30 days",
    "Tab. Ecosprin 75 0-1-0 x 30 days",
    "Tab Montair LC 0-0-1 x 10 days",
  ].join("\n");

  function setStatus(msg, isError = false, el = $("status")) {
    el.textContent = msg;
    el.classList.toggle("error", isError);
  }

  async function call(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { "content-type": "application/json" },
      ...opts,
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function busy(on, msg) {
    document.querySelectorAll("button").forEach((b) => (b.disabled = on));
    if (msg) setStatus(msg);
  }

  // ---------------------------------------------------------------- input

  async function analyseText(text) {
    if (!text.trim()) return setStatus("Type at least one medicine, or upload a photo.", true);
    busy(true, "Matching medicines…");
    try {
      render(await call("/match", { method: "POST", body: JSON.stringify({ text }) }));
      setStatus("");
    } catch (e) {
      setStatus(e.message, true);
    } finally { busy(false); }
  }

  async function analysePhoto(file) {
    if (!file) return;
    busy(true, "Reading your prescription… (this takes a few seconds)");
    try {
      const image_base64 = await downscale(file);
      const data = await call("/extract", { method: "POST", body: JSON.stringify({ image_base64 }) });
      if (data.ocr_text) $("rx-text").value = data.ocr_text;
      render(data);
      setStatus("Photo read. Please check the medicines below.");
    } catch (e) {
      setStatus(e.message, true);
    } finally { busy(false); $("photo").value = ""; }
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

  function render(data) {
    last = data;
    const banner = $("sample-banner");
    banner.hidden = !data.is_sample_data;
    banner.textContent = data.data_notice || "";

    const tbody = $("results").querySelector("tbody");
    tbody.innerHTML = "";
    // Matched rows first, unmatched last.
    const order = { matched: 0, no_generic: 1, no_match: 2 };
    const rows = [...data.items].map((r, i) => ({ ...r, _i: i }))
      .sort((a, b) => order[a.status] - order[b.status]);

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.index = r._i;
      tr.append(
        cell(nameCell(r)),
        cell(qtyInput(r)),
        cell(equivalentCell(r)),
        cell(r.status === "matched" ? `<span class="save">${rupee(r.monthly_saving)}</span><div class="salt">${r.saving_pct}% less</div>` : "—", "num-col"),
      );
      tbody.append(tr);
    }

    const s = data.summary;
    $("step-results").hidden = false;
    $("step-savings").hidden = s.matched === 0;
    $("step-kendra").hidden = s.matched === 0;
    if (s.matched) {
      $("s-brand").textContent = rupee(s.brand_monthly);
      $("s-generic").textContent = rupee(s.generic_monthly);
      $("s-month").textContent = rupee(s.monthly_saving);
      $("s-year").textContent = rupee(s.yearly_saving);
      $("s-pct").textContent = `${s.saving_pct}% less on ${s.matched} of ${s.total} lines`;
      $("btn-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(shareText(data));
    }
    setStatus("", false, $("share-status"));
    $("step-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cell(html, cls) {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    if (html instanceof Node) td.append(html); else td.innerHTML = html;
    return td;
  }

  function nameCell(r) {
    const wrap = document.createElement("div");
    const input = document.createElement("input");
    input.value = r.brand ? r.brand.brand : r.query;
    input.className = "query";
    input.setAttribute("aria-label", "Medicine name");
    wrap.append(input);
    const note = document.createElement("div");
    note.className = "salt";
    if (r.brand) note.textContent = r.brand.salts.map((x) => `${x.name} ${x.strength}`).join(" + ");
    else note.innerHTML = `<span class="pill bad">not recognised</span> “${escapeHtml(r.raw)}”`;
    wrap.append(note);
    return wrap;
  }

  function qtyInput(r) {
    const input = document.createElement("input");
    input.type = "number"; input.min = 0; input.max = 999;
    input.value = r.units; input.className = "qty";
    input.setAttribute("aria-label", "Tablets per month");
    return input;
  }

  function equivalentCell(r) {
    if (r.status === "matched") {
      return `<b>${escapeHtml(r.generic.name)}</b>
        <div class="salt">${rupee(r.generic_unit_price * 10)} per 10 vs ${rupee(r.brand_unit_price * 10)} branded</div>
        <span class="pill">same salt &amp; strength</span>`;
    }
    if (r.status === "no_generic") return `<span class="pill warn">no Jan Aushadhi equivalent in our list</span>`;
    return "—";
  }

  function shareText(data) {
    const lines = ["My Jan Aushadhi list (via SastiDawa):"];
    for (const r of data.items) {
      if (r.status === "matched") lines.push(`• ${r.brand.brand} → ${r.generic.name}${r.generic.code ? " [" + r.generic.code + "]" : ""} × ${r.units}`);
    }
    lines.push(`Estimated saving: ${rupee(data.summary.monthly_saving)}/month.`);
    if (data.is_sample_data) lines.push("(Demo with SAMPLE prices.)");
    lines.push("Please confirm with the pharmacist.");
    return lines.join("\n");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // -------------------------------------------------------------- recheck

  async function recheck() {
    const items = [...$("results").querySelectorAll("tbody tr")].map((tr) => ({
      raw: last.items[tr.dataset.index].raw,
      query: tr.querySelector("input.query").value.trim(),
      units: Number(tr.querySelector("input.qty").value) || 0,
    })).filter((i) => i.query);
    busy(true, "Rechecking…");
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
      setStatus(`Link copied: ${url} (valid for 30 days)`, false, el);
    } catch (e) { setStatus(e.message, true, el); }
  }

  async function loadShared(id) {
    busy(true, "Opening shared list…");
    try {
      const rec = await call("/share/" + encodeURIComponent(id));
      // Re-run matching so prices and status are current.
      const items = rec.items.map((i) => ({ query: i.brand || i.query, units: i.units }));
      render(await call("/match", { method: "POST", body: JSON.stringify({ items }) }));
      setStatus("Showing a shared list.");
    } catch (e) { setStatus(e.message, true); }
    finally { busy(false); }
  }

  // -------------------------------------------------------------- kendras

  async function findKendras(query) {
    const list = $("kendra-list");
    list.innerHTML = "<li>Searching…</li>";
    try {
      const data = await call("/kendras?" + new URLSearchParams(query));
      if (!data.kendras.length) { list.innerHTML = "<li>No Kendra found near this pincode in our list.</li>"; return; }
      list.innerHTML = data.kendras.map((k) => `<li><b>${escapeHtml(k.name)}</b>
        ${k.distance_km != null ? ` · ${k.distance_km} km` : ""}<br>
        <span class="salt">${escapeHtml(k.address)}, ${escapeHtml(k.pincode)}</span>
        · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${k.lat},${k.lon}">Directions</a></li>`).join("")
        + (data.is_sample_data ? `<li class="salt">${escapeHtml(data.data_notice)}</li>` : "");
    } catch (e) { list.innerHTML = `<li class="status error">${escapeHtml(e.message)}</li>`; }
  }

  // --------------------------------------------------------------- wiring

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
      () => { $("kendra-list").innerHTML = "<li>Location permission denied. Enter your pincode instead.</li>"; },
    );
  });

  const shared = new URLSearchParams(location.search).get("list");
  if (shared) loadShared(shared);
})();
