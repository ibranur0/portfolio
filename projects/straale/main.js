import { VERTEX, TRACE, DISPLAY, MAX_SPHERES } from './shaders.js';
import { SCENES, TYPES } from './scenes.js';
import { el, store } from '../../assets/js/ui.js';

const SAVE_KEY = 'straale:scene';
const MAX_SAMPLES = 3000;      // bildet er rent lenge før dette. Da stopper vi og sparer strøm.
const MAX_WIDTH = 1280;
const ASPECT = 16 / 10;

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const comma = (value, digits) => value.toFixed(digits).replace('.', ',');

/* ---------- Vektorer ---------- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / Math.hypot(...a));

/* ====================== WebGL ====================== */
function fail(message) {
  $('overlay').hidden = false;
  $('overlay').textContent = message;
  for (const id of ['pause', 'save']) $(id).disabled = true;
}

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
let ready = false;
let trace = null, display = null;
let targets = [];            // to teksturer med hver sin rammebuffer: vi leser fra den ene og skriver til den andre
let format = null;

function program(fragment, uniforms) {
  const build = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'ukjent feil i shaderen');
    return shader;
  };
  const handle = gl.createProgram();
  gl.attachShader(handle, build(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(handle, build(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) || 'klarte ikke å lenke shaderne');
  const at = {};
  for (const name of uniforms) at[name] = gl.getUniformLocation(handle, name);
  return { handle, at };
}

function setup() {
  if (!gl) { fail('Nettleseren din støtter ikke WebGL 2, som strålesporeren trenger.'); return; }
  // Gjennomsnittet lagres som flyttall. Åtte bit per farge er for grovt når tusen bilder skal legges sammen.
  if (gl.getExtension('EXT_color_buffer_float')) format = { internal: gl.RGBA32F, type: gl.FLOAT };
  else if (gl.getExtension('EXT_color_buffer_half_float')) format = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
  else { fail('Skjermkortet kan ikke tegne til flyttallsteksturer, som strålesporeren trenger.'); return; }
  try {
    trace = program(TRACE, ['uPrevious', 'uSamples', 'uResolution', 'uOrigin', 'uForward', 'uRight', 'uUp', 'uTanHalfFov', 'uAperture', 'uFocus',
      'uBounces', 'uCount', 'uSphere', 'uMaterial', 'uSkyTop', 'uSkyHorizon', 'uSunDirection', 'uSunColor', 'uGroundA', 'uGroundB', 'uGroundRoughness', 'uRoom']);
    display = program(DISPLAY, ['uImage', 'uExposure']);
  } catch (error) {
    fail(`Shaderen lot seg ikke kompilere på dette skjermkortet: ${error.message}`);
    return;
  }
  gl.bindVertexArray(gl.createVertexArray());
  ready = true;
}

function createTargets(width, height) {
  for (const target of targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); }
  targets = [0, 1].map(() => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, width, height, 0, gl.RGBA, format.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ====================== Tilstand ====================== */
let scene = SCENES[0];
const camera = { yaw: 0, pitch: 0, distance: 9, target: [0, 1, 0], fov: 36 };
let samples = 0;
let paused = false;
let visible = true;
let passes = 1;            // strålesporingsrunder per bilde, justeres etter hvor fort skjermkortet er
let lastFrame = 0, smoothed = 16.7;
let rate = { at: 0, samples: 0, perSecond: 0 };

const restart = () => { samples = 0; rate = { at: performance.now(), samples: 0, perSecond: rate.perSecond }; wake(); };

function basis() {
  const { yaw, pitch, distance, target } = camera;
  const origin = add(target, [Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance]);
  const forward = normalize(sub(target, origin));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { origin, forward, right, up: cross(right, forward) };
}

function resize() {
  const quality = Number(document.querySelector('input[name="quality"]:checked').value);
  const cssWidth = $('viewport').clientWidth;
  if (!cssWidth) return;
  const width = Math.max(160, Math.round(Math.min(cssWidth * Math.min(window.devicePixelRatio || 1, 2), MAX_WIDTH) * quality));
  const height = Math.round(width / ASPECT);
  if (width === canvas.width && height === canvas.height && targets.length) return;
  canvas.width = width; canvas.height = height;
  createTargets(width, height);
  $('s-size').textContent = `${width} x ${height}`;
  restart();
}

function uploadScene() {
  const spheres = new Float32Array(MAX_SPHERES * 4), materials = new Float32Array(MAX_SPHERES * 4);
  scene.spheres.slice(0, MAX_SPHERES).forEach((s, k) => {
    spheres.set([...s.center, s.radius], k * 4);
    materials.set([...s.color, TYPES[s.type] + s.param / 1000], k * 4);
  });
  gl.useProgram(trace.handle);
  gl.uniform1i(trace.at.uCount, Math.min(scene.spheres.length, MAX_SPHERES));
  gl.uniform4fv(trace.at.uSphere, spheres);
  gl.uniform4fv(trace.at.uMaterial, materials);
  gl.uniform3fv(trace.at.uSkyTop, scene.sky.top);
  gl.uniform3fv(trace.at.uSkyHorizon, scene.sky.horizon);
  gl.uniform3fv(trace.at.uSunDirection, normalize(scene.sky.sun));
  gl.uniform3fv(trace.at.uSunColor, scene.sky.sunColor);
  gl.uniform3fv(trace.at.uGroundA, scene.ground.a);
  gl.uniform3fv(trace.at.uGroundB, scene.ground.b);
  gl.uniform1f(trace.at.uGroundRoughness, scene.ground.roughness);
  gl.uniform1i(trace.at.uRoom, scene.room ? 1 : 0);
}

/* ====================== Tegning ====================== */
function render() {
  const { origin, forward, right, up } = basis();
  gl.viewport(0, 0, canvas.width, canvas.height);

  if (samples < MAX_SAMPLES && !paused) {
    gl.useProgram(trace.handle);
    gl.uniform2f(trace.at.uResolution, canvas.width, canvas.height);
    gl.uniform3fv(trace.at.uOrigin, origin);
    gl.uniform3fv(trace.at.uForward, forward);
    gl.uniform3fv(trace.at.uRight, right);
    gl.uniform3fv(trace.at.uUp, up);
    gl.uniform1f(trace.at.uTanHalfFov, Math.tan((camera.fov * Math.PI) / 360));
    gl.uniform1f(trace.at.uAperture, Number($('aperture').value));
    gl.uniform1f(trace.at.uFocus, Number($('focus').value));
    gl.uniform1i(trace.at.uBounces, Number($('bounces').value));
    gl.uniform1i(trace.at.uPrevious, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (let pass = 0; pass < passes && samples < MAX_SAMPLES; pass++) {
      // Les forrige gjennomsnitt, legg til en ny stråle per piksel, skriv til den andre teksturen. Så bytter de plass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, targets[0].texture);
      gl.uniform1i(trace.at.uSamples, samples);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      targets.reverse();
      samples++;
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(display.handle);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, targets[0].texture);
  gl.uniform1i(display.at.uImage, 0);
  gl.uniform1f(display.at.uExposure, scene.exposure);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderStats(now) {
  $('s-samples').textContent = samples.toLocaleString('nb-NO');
  if (now - rate.at >= 500) {
    rate.perSecond = ((samples - rate.samples) * 1000) / (now - rate.at);
    rate.at = now; rate.samples = samples;
  }
  const done = samples >= MAX_SAMPLES;
  const rays = rate.perSecond * canvas.width * canvas.height;
  $('s-rays').textContent = paused || done || !rays ? '-' : rays >= 1e6 ? `${comma(rays / 1e6, rays >= 1e7 ? 0 : 1)} mill.` : `${Math.round(rays / 1000)} k`;
  $('s-fps').textContent = paused || done ? '-' : String(Math.round(1000 / smoothed));
  $('pause').textContent = paused ? 'Fortsett' : 'Pause';
  $('pause').disabled = done;
}

let scheduled = 0;
function frame(now) {
  scheduled = 0;
  if (!ready || !visible) return;
  const elapsed = Math.min(250, now - lastFrame);
  lastFrame = now;
  smoothed += (elapsed - smoothed) * 0.1;
  // Flere runder per bilde når skjermkortet har tid, færre når det sliter.
  if (smoothed < 19 && passes < 6) passes += 0.02; else if (smoothed > 30 && passes > 1) passes -= 0.1;
  const wanted = passes;
  passes = Math.max(1, Math.floor(passes));
  render();
  passes = wanted;
  renderStats(now);
  if (!paused && samples < MAX_SAMPLES) wake();
}
/** Starter tegneløkken hvis den ikke allerede går. Den stopper av seg selv når bildet er ferdig. */
function wake() {
  if (!scheduled && ready && visible) scheduled = requestAnimationFrame(frame);
}

/* ====================== Kamera ====================== */
const setOutput = (id, digits) => { $(`out-${id}`).textContent = digits ? comma(Number($(id).value), digits) : $(id).value; };

function orbit(dYaw, dPitch) {
  camera.yaw += dYaw;
  camera.pitch = Math.max(0.03, Math.min(1.45, camera.pitch + dPitch));
  restart();
}

/** Avstanden langs synsretningen til det første strålen fra kameraet treffer (kuler og bakken). */
function focusAt(u, v) {
  const { origin, forward, right, up } = basis();
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const direction = normalize(add(forward, add(scale(right, u * tan * ASPECT), scale(up, v * tan))));
  let nearest = Infinity;
  for (const s of scene.spheres) {
    const oc = sub(origin, s.center);
    const b = dot(oc, direction), disc = b * b - (dot(oc, oc) - s.radius * s.radius);
    if (disc >= 0 && -b - Math.sqrt(disc) > 0.01) nearest = Math.min(nearest, -b - Math.sqrt(disc));
  }
  if (direction[1] < 0) nearest = Math.min(nearest, -origin[1] / direction[1]);
  return Number.isFinite(nearest) ? nearest * dot(direction, forward) : null;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved > 4) orbit(-dx * 0.006, dy * 0.006);
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && drag.id === e.pointerId && drag.moved <= 4) {
    // Et klikk uten dra: still skarpt på det som ble truffet.
    const rect = canvas.getBoundingClientRect();
    const distance = focusAt(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2);
    if (distance) {
      $('focus').value = Math.max(2, Math.min(20, distance));
      setOutput('focus', 1);
      if (Number($('aperture').value) < 0.04) { $('aperture').value = 0.12; setOutput('aperture', 2); } // ellers ser man ingen forskjell
      restart();
    }
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.tabIndex = 0;
canvas.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
  if (!step) return;
  e.preventDefault();
  orbit(...step);
});

/* ====================== Kontroller ====================== */
function loadScene(index) {
  scene = SCENES[index];
  Object.assign(camera, scene.camera, { target: [...scene.camera.target] });
  $('aperture').value = scene.camera.aperture;
  $('focus').value = scene.camera.distance;
  $('distance').value = scene.camera.distance;
  setOutput('aperture', 2); setOutput('focus', 1); setOutput('distance', 1);
  $('scene-note').textContent = scene.note;
  document.querySelector(`input[name="scene"][value="${index}"]`).checked = true;
  store.set(SAVE_KEY, index);
  if (ready) { uploadScene(); restart(); }
}

$('scene').replaceChildren(...SCENES.map((item, k) =>
  el('label', {}, el('input', { type: 'radio', name: 'scene', value: String(k) }), el('span', { text: item.name }))));
$('scene').addEventListener('change', (e) => loadScene(Number(e.target.value)));
$('bounces').addEventListener('input', () => { setOutput('bounces'); restart(); });
$('aperture').addEventListener('input', () => { setOutput('aperture', 2); restart(); });
$('focus').addEventListener('input', () => { setOutput('focus', 1); restart(); });
$('distance').addEventListener('input', () => { camera.distance = Number($('distance').value); setOutput('distance', 1); restart(); });
$('quality').addEventListener('change', resize);
$('pause').addEventListener('click', () => { paused = !paused; renderStats(performance.now()); wake(); });
$('save').addEventListener('click', () => {
  render(); // tegnebufferen tømmes etter hvert bilde, så bildet tegnes på nytt rett før det leses ut
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = el('a', { href: URL.createObjectURL(blob), download: `straale-${scene.name.toLowerCase()}-${samples}.png` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }, 'image/png');
});

// Tegn bare når bildet er synlig: ingen grunn til å bruke skjermkortet på en fane i bakgrunnen.
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting && !document.hidden; wake(); }).observe(canvas);
document.addEventListener('visibilitychange', () => { visible = !document.hidden; lastFrame = performance.now(); wake(); });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ready = false; fail('Skjermkortet avbrøt tegningen. Last siden på nytt for å fortsette.'); });

/* ====================== Oppstart ====================== */
setup();
const saved = store.get(SAVE_KEY, 0);
loadScene(Number.isInteger(saved) && saved >= 0 && saved < SCENES.length ? saved : 0);
if (ready) {
  uploadScene();
  new ResizeObserver(resize).observe($('viewport'));
  resize();
}
