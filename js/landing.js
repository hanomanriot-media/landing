/* Hanoman Riot — landing
   Rute hash, View Transition API, parallax, objek 3D yang bisa ditarik,
   Spotify iFrame API sebagai mesin bunyi. Tanpa pustaka. */

const TRACKS = [
  { n: "01", title: "Tersesat", dur: "3:14", sec: 194, id: "46ZkVkRzH8BfLyd3XCDcQL" },
  { n: "02", title: "Tentang Gurindam", dur: "2:26", sec: 146, id: "36qRoVVJHj55OpY2ImG1NT" },
  { n: "03", title: "Relung", dur: "4:08", sec: 248, id: "6RZT6QmqBShcZMUtyTRrjC" },
  { n: "04", title: "Pelik Dan Pelikan", dur: "3:16", sec: 196, id: "5RQZL5xH7zsjGrv12kvEkq" },
];

const root = document.documentElement;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------- gerak ---------- */

const motionPref = () => store.get("hr-gerak") || (matchMedia("(prefers-reduced-motion: reduce)").matches ? "kurang" : "penuh");
let gerak = motionPref();
const bolehGerak = () => gerak === "penuh";

function applyGerak() {
  root.classList.toggle("gerak-kurang", !bolehGerak());
  const btn = document.querySelector("[data-motion-toggle]");
  btn.setAttribute("aria-pressed", String(bolehGerak()));
  btn.querySelector("[data-motion-label]").textContent = bolehGerak() ? "Gerak penuh" : "Gerak kurang";
  if (!bolehGerak()) resetParallax();
}

document.querySelector("[data-motion-toggle]").addEventListener("click", () => {
  gerak = bolehGerak() ? "kurang" : "penuh";
  store.set("hr-gerak", gerak);
  applyGerak();
});

/* ---------- tampilan ---------- */

const views = {
  hero: document.getElementById("view-hero"),
  radio: document.getElementById("view-radio"),
  rilis: document.getElementById("view-rilis"),
};
const state = { view: "hero", radio: "a", track: 0, playing: false, loading: false };

function parseHash() {
  const h = location.hash.replace("#", "");
  if (h.startsWith("radio")) return { view: "radio", radio: h.endsWith("-b") ? "b" : "a" };
  if (h === "rilis") return { view: "rilis" };
  return { view: "hero" };
}

function applyRoute() {
  const { view, radio } = parseHash();
  const target = views[view];
  if (!target) return;

  Object.entries(views).forEach(([name, el]) => {
    const on = name === view;
    el.hidden = !on;
    el.classList.toggle("is-active", on);
    el.classList.remove("is-entering");
  });

  state.view = view;
  if (radio) state.radio = radio;

  document.querySelectorAll(".ab__btn").forEach((b) => {
    const on = b.dataset.radio === state.radio;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-body]").forEach((el) => {
    el.hidden = el.dataset.body !== state.radio;
  });
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.go === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  target.scrollTop = 0;
  if (view === "hero") resetParallax(true);
  else stopParallax();
  if (view === "radio") preload();
  drawAll();
  const h = target.querySelector("h1,h2");
  if (h) h.focus({ preventScroll: true });
}

function show(withMotion = true) {
  applyRoute();
  const target = views[state.view];
  if (!target) return;
  if (!withMotion || !bolehGerak()) return;
  target.classList.add("is-entering");
  setTimeout(() => target.classList.remove("is-entering"), 900);
}

function go(hash) {
  if (location.hash === hash) { show(); return; }
  if (document.startViewTransition && bolehGerak()) {
    document.startViewTransition(() => {
      location.hash = hash;
      show(false);
    });
    setTimeout(() => {
      const t = views[state.view];
      if (!t) return;
      t.classList.add("is-entering");
      setTimeout(() => t.classList.remove("is-entering"), 900);
    }, 40);
  } else {
    location.hash = hash;
    show();
  }
}

addEventListener("hashchange", () => show());

document.addEventListener("click", (e) => {
  const goEl = e.target.closest("[data-go]");
  if (goEl) {
    e.preventDefault();
    go(goEl.dataset.go === "radio" ? `#radio-${state.radio}` : `#${goEl.dataset.go}`);
    return;
  }
  const ab = e.target.closest(".ab__btn");
  if (ab) { e.preventDefault(); go(`#radio-${ab.dataset.radio}`); return; }

  if (e.target.closest("[data-play-first]")) {
    go(`#radio-${state.radio}`);
    setTimeout(() => play(), 420);
    return;
  }
  if (e.target.closest("[data-play]")) { togglePlay(); return; }
  if (e.target.closest("[data-next]")) { step(1); return; }
  if (e.target.closest("[data-prev]")) { step(-1); return; }

  const t = e.target.closest("[data-track]");
  if (t) select(Number(t.dataset.track), state.playing);
});

/* ---------- Spotify ---------- */

const dock = document.getElementById("spotify-embed");
const dockState = document.querySelector("[data-dock-state]");
const statusEl = document.querySelector("[data-status]");
const stateEl = document.querySelector("[data-state]");

let api = null, ctrl = null, apiPromise = null, ctrlPromise = null;
let lastPos = 0, lastDur = 0, fallbackFrame = null, watchTimer = 0, preloaded = false;

/* Bentuk URI yang diterima Spotify iFrame API memakai titik dua, bukan garis miring.
   Versi `spotify:track/…` ditolak dengan "Invalid URI" dan tombol daya diam saja. */
const trackUri = (id) => `spotify:track:${id}`;

function setStatus(text, kind) {
  if (statusEl) statusEl.textContent = text;
  if (dockState) dockState.textContent = kind || text;
}

/* Sorot kotak pemutar Spotify di daftar lagu. Dipakai saat objek tidak bisa
   memutar sendiri, supaya tombol tetap melakukan sesuatu yang terlihat. */
function nudgeDock(pesan) {
  if (!dock) return;
  dock.classList.add("is-unjuk");
  dock.scrollIntoView({ block: "center", behavior: bolehGerak() ? "smooth" : "auto" });
  setTimeout(() => dock.classList.remove("is-unjuk"), 2000);
  if (pesan) setStatus(pesan, "Ketuk pemutar");
}

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 12000);
    window.onSpotifyIframeApiReady = (IFrameAPI) => { clearTimeout(timer); api = IFrameAPI; resolve(IFrameAPI); };
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error("jaringan")); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

function makeController() {
  if (ctrlPromise) return ctrlPromise;
  dock.dataset.empty = "false";
  ctrlPromise = loadApi().then((IFrameAPI) => new Promise((resolve) => {
    const host = document.createElement("div");
    dock.replaceChildren(host);
    IFrameAPI.createController(host, { uri: trackUri(TRACKS[state.track].id), width: "100%", height: 152 }, (controller) => {
      ctrl = controller;
      ctrl.addListener("playback_update", (e) => {
        const d = e.data || {};
        const paused = d.isPaused !== false;
        lastPos = (d.position || 0) / 1000;
        lastDur = (d.duration || 0) / 1000;
        setPlaying(!paused);
        paintProgress();
      });
      ctrl.addListener("playback_error", () => {
        setStatus("Spotify menolak pemutaran. Coba buka tautan Spotify di bawah.", "Gagal");
        setPlaying(false);
      });
      setStatus("Pemutar siap. Tekan tombol daya.", "Siap");
      applyVolume();
      resolve(controller);
    });
  })).catch((err) => {
    ctrlPromise = null;
    mountFallback();
    setStatus(err.message === "timeout" || err.message === "jaringan"
      ? "Spotify tidak menjawab. Kotak pemutar dipasang tanpa kendali objek: tekan tombol putar di kotaknya."
      : `Kendali objek gagal: ${err.message}. Kotak pemutar dipasang: tekan tombol putar di kotaknya.`, "Cadangan");
    if (stateEl) stateEl.textContent = "Berhenti";
    document.querySelectorAll("[data-play]").forEach((b) => {
      b.setAttribute("aria-busy", "false");
      b.classList.remove("is-error");
    });
    throw err;
  });
  return ctrlPromise;
}

/* Dimuat lebih awal supaya klik tombol daya tidak menunggu unduhan skrip Spotify. */
function preload() {
  if (preloaded || !dock) return;
  preloaded = true;
  makeController().catch(() => {});
}

function mountFallback() {
  dock.dataset.empty = "false";
  const f = document.createElement("iframe");
  f.title = "Pemutar Spotify";
  f.width = "100%"; f.height = "152"; f.loading = "lazy";
  f.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  f.style.border = "0";
  f.src = `https://open.spotify.com/embed/track/${TRACKS[state.track].id}?utm_source=generator&theme=0`;
  dock.replaceChildren(f);
  fallbackFrame = f;
}

function setPlaying(on) {
  state.playing = on;
  if (on) {
    clearTimeout(watchTimer);
    if (dock) dock.classList.remove("is-unjuk");
  }
  document.querySelectorAll("[data-play]").forEach((b) => {
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-busy", "false");
    const label = b.querySelector(".btn__label");
    if (label) label.textContent = on ? "Jeda" : "Putar";
    b.setAttribute("aria-label", on ? "Jeda" : "Putar");
  });
  document.querySelectorAll("[data-body]").forEach((o) => o.classList.toggle("is-playing", on));
  if (stateEl) stateEl.textContent = on ? "Memutar" : "Berhenti";
  if (on) setStatus("Memutar lewat Spotify.", "Memutar");
  else if (statusEl && statusEl.textContent === "Memutar lewat Spotify.") setStatus("Berhenti. Tekan tombol daya untuk memutar.", "Berhenti");
  if (on) loop(); else drawAll();
}

async function play() {
  const btn = document.querySelector("[data-play]");
  /* Kotak Spotify cadangan tidak bisa dikendalikan dari luar. Arahkan ke tombolnya,
     jangan diam seolah tidak terjadi apa-apa. */
  if (!ctrl && fallbackFrame) {
    nudgeDock("Objek tidak bisa memutar sendiri. Tekan tombol putar di kotak Spotify.");
    return;
  }
  if (btn) btn.setAttribute("aria-busy", "true");
  if (stateEl) stateEl.textContent = "Memuat…";
  try {
    const c = ctrl || (await makeController());
    if (state.playing) return;
    await c.play();
    /* Spotify bisa menerima perintah lalu tidak bersuara: tidak ada akun, kebijakan
       putar-otomatis peramban, atau blokir. Beri tahu setelah 3,5 detik, jangan
       biarkan tulisan "Memuat…" bertahan selamanya. */
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      if (state.playing) return;
      if (stateEl) stateEl.textContent = "Berhenti";
      nudgeDock("Spotify belum mulai. Tekan tombol putar di kotak pemutar, atau masuk dengan akun Spotify.");
    }, 3500);
  } catch (err) {
    if (stateEl) stateEl.textContent = "Berhenti";
    setStatus(`Gagal memutar: ${err.message}`, "Gagal");
  } finally {
    if (btn) btn.setAttribute("aria-busy", "false");
  }
}

function togglePlay() {
  if (state.playing) {
    if (ctrl) ctrl.pause();
    setPlaying(false);
    return;
  }
  play();
}

function step(dir) {
  select((state.track + dir + TRACKS.length) % TRACKS.length, state.playing);
}

async function select(i, andPlay) {
  state.track = i;
  const t = TRACKS[i];
  document.querySelectorAll("[data-now]").forEach((el) => (el.textContent = t.title));
  document.querySelectorAll("[data-clock]").forEach((el) => (el.textContent = `00:00 / ${t.dur}`));
  document.querySelectorAll("[data-track]").forEach((b) => {
    b.setAttribute("aria-current", String(Number(b.dataset.track) === i));
  });
  lastPos = 0; lastDur = t.sec;
  paintProgress();
  if (ctrl) {
    ctrl.loadUri(trackUri(t.id));
    if (andPlay) setTimeout(() => ctrl.play(), 260);
  } else if (fallbackFrame) {
    fallbackFrame.src = `https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`;
  }
  if (!ctrl && andPlay) play();
  drawAll();
  if (stateEl) stateEl.textContent = andPlay ? "Memuat…" : "Berhenti";
}

/* ---------- waktu dan jarum ---------- */

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function paintProgress() {
  const t = TRACKS[state.track];
  const dur = lastDur || t.sec;
  const pct = Math.min(1, Math.max(0, lastPos / dur));
  document.querySelectorAll("[data-clock]").forEach((el) => {
    el.textContent = `${fmt(lastPos)} / ${fmt(dur)}`;
  });
  document.querySelectorAll("[data-progress]").forEach((el) => {
    el.style.width = `${(pct * 100).toFixed(1)}%`;
  });
  const needle = document.querySelector("[data-needle]");
  if (needle) needle.style.setProperty("--nx", `${((pct - 0.5) * 46).toFixed(1)}px`);
}

/* ---------- gelombang ---------- */

const wave = document.querySelector("[data-wave]");

function drawWave() {
  if (!wave) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = wave.clientWidth || 320;
  const h = wave.clientHeight || 72;
  if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) {
    wave.width = Math.round(w * dpr);
    wave.height = Math.round(h * dpr);
  }
  const ctx = wave.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const step = 7;
  const n = Math.max(12, Math.floor(w / step));
  const t = performance.now() / 1000;
  const playing = state.playing && bolehGerak();
  for (let i = 0; i < n; i++) {
    const shape = 0.16 + 0.84 * Math.abs(Math.sin((i + 1) * 1.7) * Math.cos(i * 0.23));
    const breath = playing ? 0.68 + 0.32 * Math.sin(t * 3.4 + i * 0.55) : 1;
    const bh = Math.max(2, shape * breath * (h - 6));
    const played = i / n <= (lastPos / (lastDur || TRACKS[state.track].sec));
    ctx.fillStyle = played ? "#C9532C" : "rgba(237,230,214,.42)";
    ctx.fillRect(i * step, (h - bh) / 2, 4, bh);
  }
}

function drawAll() { drawWave(); }

let raf = 0;
function loop() {
  if (raf) return;
  const tick = () => {
    if (!state.playing || !bolehGerak() || document.hidden) { raf = 0; drawAll(); return; }
    drawAll();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

addEventListener("resize", drawAll);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.playing) loop(); });

/* ---------- parallax ---------- */

const hero = document.getElementById("hero");
const heroView = views.hero;
const layersOf = () => [...document.querySelectorAll("#hero [data-depth]")];

/* px, py = posisi penunjuk ternormalisasi -1..1, diperhalus tiap bingkai */
let px = 0, py = 0, pxT = 0, pyT = 0, parRaf = 0;
const lerpK = 0.18;

function paintParallax() {
  layersOf().forEach((el) => {
    const d = Number(el.dataset.depth) || 0;
    const arah = el.dataset.arah === "lawan" ? -1 : 1;
    const x = px * d * arah;
    const y = py * d * arah * 0.8;
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  });
}

function parallaxTick() {
  px += (pxT - px) * lerpK;
  py += (pyT - py) * lerpK;
  const tenang = Math.abs(pxT - px) < 0.002 && Math.abs(pyT - py) < 0.002;
  if (tenang) { px = pxT; py = pyT; }
  paintParallax();
  if (tenang) {
    parRaf = 0;
    if (px === 0 && py === 0) layersOf().forEach((el) => (el.style.transform = ""));
    return;
  }
  parRaf = requestAnimationFrame(parallaxTick);
}

function startParallax() {
  if (!parRaf) parRaf = requestAnimationFrame(parallaxTick);
}

function stopParallax() {
  if (parRaf) cancelAnimationFrame(parRaf);
  parRaf = 0;
  px = py = pxT = pyT = 0;
  layersOf().forEach((el) => (el.style.transform = ""));
}

function resetParallax(segera = false) {
  pxT = 0;
  pyT = 0;
  if (segera || !bolehGerak() || !matchMedia("(pointer: fine)").matches) return stopParallax();
  return startParallax();
}

if (hero) {
  hero.addEventListener("pointermove", (e) => {
    if (!bolehGerak() || !matchMedia("(pointer: fine)").matches || state.view !== "hero") return;
    const r = hero.getBoundingClientRect();
    pxT = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    pyT = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    startParallax();
  });
  hero.addEventListener("pointerleave", () => resetParallax());

  /* ponsel: hanya sampul, satu sumbu, maksimal 24 px.
     Di 390 gulir terjadi pada dokumen, bukan pada .view. */
  const scrollParallax = () => {
    if (!bolehGerak() || matchMedia("(pointer: fine)").matches) return;
    const art = hero.querySelector(".hero__art");
    if (!art) return;
    const atas = Math.max(heroView.scrollTop, window.scrollY || 0);
    const y = Math.min(24, atas * 0.12);
    art.style.transform = `translate3d(0, ${(-y).toFixed(1)}px, 0)`;
  };
  heroView.addEventListener("scroll", scrollParallax, { passive: true });
  addEventListener("scroll", scrollParallax, { passive: true });
}

/* ---------- objek 3D: tarik untuk memutar ---------- */

function bindDrag(stage) {
  let held = false, sx = 0, sy = 0, bx = -24, by = -13, vx = 0, vy = 0, lastT = 0, rafId = 0;
  const obj = () => stage.querySelector("[data-body]:not([hidden])");

  const set = (ry, rx) => {
    const o = obj();
    if (!o) return;
    o.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    o.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, [role='slider']")) return;
    if (!bolehGerak()) return;
    held = true;
    cancelAnimationFrame(rafId);
    const o = obj();
    if (!o) return;
    o.classList.add("is-held");
    stage.classList.add("is-dragging");
    sx = e.clientX; sy = e.clientY;
    bx = Number(o.style.getPropertyValue("--ry").replace("deg", "")) || -24;
    by = Number(o.style.getPropertyValue("--rx").replace("deg", "")) || -13;
    vx = vy = 0; lastT = performance.now();
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!held) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastT);
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const ry = clamp(bx + dx * 0.34, -70, 40);
    const rx = clamp(by - dy * 0.22, -44, 10);
    vx = ((dx * 0.34) / dt) * 12;
    vy = ((-dy * 0.22) / dt) * 12;
    set(ry, rx);
    lastT = now;
  });

  const release = () => {
    if (!held) return;
    held = false;
    stage.classList.remove("is-dragging");
    const o = obj();
    if (o) {
      o.classList.remove("is-held");
      const ry = Number(o.style.getPropertyValue("--ry").replace("deg", "")) || -24;
      const rx = Number(o.style.getPropertyValue("--rx").replace("deg", "")) || -13;
      let curY = ry, curX = rx;
      const glide = () => {
        vx *= 0.92; vy *= 0.92;
        curY = clamp(curY + vx, -70, 40);
        curX = clamp(curX + vy, -44, 10);
        set(curY, curX);
        if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) rafId = requestAnimationFrame(glide);
      };
      if (Math.abs(vx) > 0.2 || Math.abs(vy) > 0.2) rafId = requestAnimationFrame(glide);
    }
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const stageEl = document.getElementById("stage");
if (stageEl) bindDrag(stageEl);

/* ---------- volume ---------- */

const knob = document.querySelector("[data-vol]");
let volume = 0.8;

function applyVolume() {
  if (knob) {
    knob.style.setProperty("--kv", volume.toFixed(2));
    knob.setAttribute("aria-valuenow", String(Math.round(volume * 100)));
  }
  if (ctrl) { try { ctrl.setVolume(volume); } catch {} }
}

if (knob) {
  let down = false, startY = 0, startV = volume;
  knob.addEventListener("pointerdown", (e) => {
    down = true; startY = e.clientY; startV = volume;
    knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener("pointermove", (e) => {
    if (!down) return;
    volume = clamp(startV - (e.clientY - startY) / 140, 0, 1);
    applyVolume();
  });
  knob.addEventListener("pointerup", () => { down = false; });
  knob.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { volume = clamp(volume + 0.1, 0, 1); applyVolume(); e.preventDefault(); }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { volume = clamp(volume - 0.1, 0, 1); applyVolume(); e.preventDefault(); }
  });
}
applyVolume();

/* ---------- mulai ---------- */

applyGerak();
document.querySelectorAll(".line").forEach((el, i) => el.style.setProperty("--li", i));
state.track = 0;
document.querySelectorAll("[data-track]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.track === "0")));
lastDur = TRACKS[0].sec;
paintProgress();
applyRoute();
requestAnimationFrame(() => requestAnimationFrame(() => show()));

addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "1") go("#radio-a");
  if (e.key === "2") go("#radio-b");
  if (e.key === " " && state.view === "radio" && !e.target.closest("button")) { e.preventDefault(); togglePlay(); }
});
