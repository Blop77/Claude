// Shared hero for index.html and submission.html: a glass magnifying lens drifting over
// floating capsules (Three.js), the hero text intro and scroll reveals (GSAP).
// Everything here is decoration: if WebGL or the CDNs fail, the pages still work.
// Loaded as a classic script (not type="module") so it also runs when the HTML is opened from file://;
// Three.js comes in through dynamic import(), resolved by the page's import map.
(() => {

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { gsap, ScrollTrigger } = window;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
gsap?.config({ nullTargetWarn: false }); // pages share one intro; not every page has every element
const hero = document.querySelector(".hero");

// ------------------------------------------------------------------ nav
const nav = document.querySelector(".nav");
if (nav && hero) {
  new IntersectionObserver(([e]) => nav.classList.toggle("solid", !e.isIntersecting), { rootMargin: "-68px 0px 0px 0px" }).observe(hero);
}

// --------------------------------------------------------------- scene
const intro = { t: reduce ? 1 : 0 };
const box = document.getElementById("gl");
// Phones and tablets get a static hero (no WebGL, no motion): too heavy for them. Decided once at load.
const lite = matchMedia("(max-width: 820px), (pointer: coarse)").matches;
if (lite) document.documentElement.classList.add("lite");
else if (box) {
  Promise.all([import("three"), import("three/addons/environments/RoomEnvironment.js")])
    .then(([THREE, { RoomEnvironment }]) => initScene(box, THREE, RoomEnvironment))
    .catch((e) => console.warn("WebGL hero disabled:", e));
}

function initScene(box, THREE, RoomEnvironment) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "A glass magnifying lens drifting over floating medicine capsules.");
  box.append(canvas);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 6, 8);
  scene.add(key);

  // Backdrop the lens refracts: dark green glow + faint graph-paper grid.
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { uFocus: { value: new THREE.Vector2(0.64, 0.5) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `varying vec2 vUv; uniform vec2 uFocus;
      void main(){
        vec2 a = vec2(1.78, 1.0);
        vec3 col = vec3(0.016, 0.063, 0.043);
        float g = smoothstep(0.62, 0.0, distance(vUv * a, uFocus * a));
        col += vec3(0.08, 0.36, 0.24) * g;
        col += vec3(0.40, 0.27, 0.07) * 0.32 * smoothstep(0.5, 0.0, distance(vUv * a, vec2(0.12, 0.12) * a));
        vec2 q = vUv * vec2(64.0, 36.0) * 1.25;
        vec2 d = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        float line = 1.0 - min(min(d.x, d.y), 1.0);
        col += vec3(0.24, 0.86, 0.59) * line * (0.035 + 0.11 * g);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  bg.position.z = -9;
  scene.add(bg);

  // Two-tone capsules: ivory bottom, coloured top, split by local y.
  const capsuleMat = (top) => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xf3eee4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    m.onBeforeCompile = (s) => {
      s.uniforms.uTop = { value: new THREE.Color(top) };
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying float vY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvY = position.y;");
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vY; uniform vec3 uTop;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTop, smoothstep(-0.008, 0.008, vY));");
    };
    return m;
  };
  const mats = [0x3ddc97, 0xf2b34a, 0xe8664f, 0x5aa9e6, 0x0f7a4f].map(capsuleMat);
  const tabletMat = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.55, clearcoat: 0.4 });
  const capGeo = new THREE.CapsuleGeometry(0.26, 0.62, 12, 28);
  const tabGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.15, 48);

  const field = new THREE.Group();
  scene.add(field);
  // Pills are placed in screen space (a jittered grid, so no big empty patches) at a random depth,
  // then drift upward and wrap around, so they keep floating through the lens.
  const small = innerWidth < 700;
  const pills = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const cols = small ? 3 : 9, rows = small ? 5 : 5;
  for (let i = 0; i < cols * rows; i++) {
    const isTab = i % 5 === 4;
    const m = new THREE.Mesh(isTab ? tabGeo : capGeo, isTab ? tabletMat : mats[i % mats.length]);
    m.rotation.set(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3));
    m.userData = {
      nx: ((i % cols) + rnd(0.15, 0.85)) / cols * 2 - 1, ny: (Math.floor(i / cols) + rnd(0.15, 0.85)) / rows * 2 - 1,
      z: small ? rnd(-7, -1) : rnd(-6, 1.5), speed: rnd(0.12, 0.3), phase: rnd(0, 6.3), s: rnd(0.75, 1.2),
      spin: new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.3, 0.3)),
    };
    field.add(m);
    pills.push(m);
  }
  const halfH = (z) => (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // The lens: flattened glass sphere, metal rim, handle.
  const lens = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.6, 96, 64), new THREE.MeshPhysicalMaterial({
    transmission: 1, thickness: 0.9, ior: 1.4, roughness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    dispersion: 0.15, envMapIntensity: 0.7, specularIntensity: 0.8,
  }));
  glass.scale.z = 0.34;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.63, 0.085, 32, 160), new THREE.MeshPhysicalMaterial({ color: 0xdbe7e0, metalness: 1, roughness: 0.2 }));
  const handleMat = new THREE.MeshPhysicalMaterial({ color: 0x0c2a1d, roughness: 0.3, clearcoat: 1 });
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.9, 8, 24), handleMat);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 32), rim.material);
  const dir = new THREE.Vector2(Math.cos(-Math.PI / 4), Math.sin(-Math.PI / 4));
  collar.position.set(dir.x * 1.9, dir.y * 1.9, 0);
  handle.position.set(dir.x * 3.1, dir.y * 3.1, 0);
  collar.rotation.z = handle.rotation.z = Math.PI / 4;
  lens.add(glass, rim, collar, handle);
  scene.add(lens);


  // ----------------------------------------------------------- layout
  const anchor = new THREE.Vector3();
  let lensScale = 1;
  function layout() {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wide = camera.aspect > 1.05;
    anchor.set(wide ? 3.3 : 1.2, wide ? 0.3 : -3.1, 1.5); // phones: peek in from the bottom-right, clear of the buttons
    lensScale = wide ? 1 : 0.62;
    bg.material.uniforms.uFocus.value.set(wide ? 0.64 : 0.55, wide ? 0.52 : 0.36);
  }
  new ResizeObserver(() => { layout(); if (reduce) frame(0); }).observe(box);
  layout();

  // ------------------------------------------------------------ input
  const pointer = new THREE.Vector2(), smooth = new THREE.Vector2();
  addEventListener("pointermove", (e) => pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), { passive: true });

  // ------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  function frame(t) {
    const k = intro.t, ease = 1 - Math.pow(1 - k, 3);
    const scroll = Math.min(1, scrollY / Math.max(1, hero.offsetHeight));
    smooth.lerp(pointer, 0.05);
    for (const p of pills) {
      const u = p.userData;
      const h = halfH(u.z) * 1.25, w = h * camera.aspect * 0.92; // wrap happens off-screen
      p.position.x = u.nx * w + Math.sin(t * 0.35 + u.phase) * 0.3;
      p.position.y = ((u.ny * h + t * u.speed + h) % (2 * h) + 2 * h) % (2 * h) - h + scroll * 3;
      p.position.z = u.z;
      p.rotation.x += u.spin.x * 0.01; p.rotation.y += u.spin.y * 0.01; p.rotation.z += u.spin.z * 0.01;
      p.scale.setScalar(u.s * ease);
    }
    field.rotation.y = smooth.x * 0.08;
    field.rotation.x = -smooth.y * 0.05;
    lens.scale.setScalar(lensScale * (0.55 + 0.45 * ease) * (1 - scroll * 0.25));
    lens.position.set(
      anchor.x + smooth.x * 0.7 + (1 - ease) * 4,
      anchor.y + smooth.y * 0.45 + Math.sin(t * 0.8) * 0.12 + scroll * 4.5,
      anchor.z,
    );
    lens.rotation.set(-smooth.y * 0.18 + Math.sin(t * 0.5) * 0.04, smooth.x * 0.25 + (1 - ease) * 1.2, Math.sin(t * 0.3) * 0.06 + scroll * 0.6);
    camera.position.x = smooth.x * 0.35;
    camera.position.y = smooth.y * 0.25;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  if (reduce) { frame(0); return; }
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
  renderer.setAnimationLoop(() => { const t = clock.getElapsedTime(); if (visible) frame(t); });
}

// ------------------------------------------------------- text + reveals
function splitWords(el) {
  const out = [];
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement("span"), inner = document.createElement("span");
          w.className = "w"; inner.textContent = part; w.append(inner); frag.append(w); out.push(inner);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === 1) walk(child);
    }
  };
  walk(el);
  return out;
}

const rupeeless = (n, dec) => (dec ? n.toFixed(dec) : Math.round(n).toLocaleString("en-IN"));

document.documentElement.classList.remove("preload");
if (gsap && !reduce && !lite) {
  const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
  tl.to(intro, { t: 1, duration: 2.6, ease: "power3.out" }, 0);
  const h1 = document.querySelector(".hero h1");
  if (h1) tl.from(splitWords(h1), { yPercent: 115, rotate: 4, duration: 1.4, stagger: 0.07 }, 0.15);
  tl.from(".hero .eyebrow", { y: 14, opacity: 0, duration: 1 }, 0.1)
    .from(".hero-sub, .hero-cta, .hero-meta", { y: 26, opacity: 0, duration: 1.1, stagger: 0.1 }, 0.6)
    .from(".dose-card", { y: 50, opacity: 0, duration: 1.3 }, 0.9)
    .from(".dose-row > div", { scale: 0.5, opacity: 0, duration: 0.7, stagger: 0.14, ease: "back.out(2.2)" }, 1.3)
    .from(".scroll-cue", { opacity: 0, duration: 1 }, 1.6);

  if (ScrollTrigger && hero) {
    gsap.to(".hero-inner, .dose-card", { yPercent: -14, opacity: 0, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "55% top", scrub: true } });
    gsap.utils.toArray(".reveal").forEach((el) => gsap.from(el, { y: 50, opacity: 0, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 90%" } }));
    gsap.utils.toArray(".reveal-stagger").forEach((el) => gsap.from(el.children, { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
    document.querySelectorAll("[data-count]").forEach((el) => {
      const to = +el.dataset.count, dec = +(el.dataset.dec || 0), v = { n: 0 };
      gsap.to(v, { n: to, duration: 2, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 92%" }, onUpdate: () => (el.textContent = rupeeless(v.n, dec)) });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh()); // web fonts shift layout after triggers are measured
  }
} else {
  intro.t = 1;
}
})();
