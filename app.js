/**
 * app.js
 * -----------------------------------------------------------------------
 * The mobile-web version of inference_classifier.py. Same idea, same
 * user experience (pick a mode, show your hand, hold a sign steady to
 * "type" it) -- just running in a phone browser instead of a Python
 * window, using MediaPipe's Tasks-for-Web HandLandmarker instead of the
 * desktop `mediapipe.solutions.hands` API.
 *
 * IMPORTANT -- this file needs internet access to work:
 *   - The MediaPipe WASM runtime and hand-landmark model are streamed
 *     from Google's/jsDelivr's CDNs the first time you tap Start Camera
 *     (the service worker caches the app's own files for offline reuse,
 *     but not these external CDN resources -- see service-worker.js).
 *   - This could NOT be end-to-end tested from the sandbox that built
 *     this project (its network policy blocks those CDN hosts), so
 *     please open the browser's developer console (Safari: Settings ->
 *     Advanced -> Web Inspector; Chrome/Android: chrome://inspect from a
 *     computer) the first time you test on a real device, and check for
 *     red errors if the camera view loads but nothing gets recognized.
 *
 * MediaPipe is loaded lazily (inside startCamera(), not as a top-level
 * `import`) on purpose: a top-level import of a remote URL fails the
 * ENTIRE script if that network request is slow or blocked, which would
 * take the whole UI (mode tabs, text buffer, buttons) down with it. This
 * way the app is fully usable, and gives a clear error, even if the
 * MediaPipe CDN is briefly unreachable.
 */

import { MODES, lookupClass } from './modes.js';

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let visionModule = null; // lazily loaded on first Start Camera tap

// Same debounce constants as inference_classifier.py.
const STABLE_FRAMES_TO_COMMIT = 15; // ~0.5s at a typical camera frame rate
const MIN_CONFIDENCE_TO_COMMIT = 60; // percent

// Standard MediaPipe hand-skeleton connections (21 landmarks).
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const els = {
  statusPill: document.getElementById('status-pill'),
  modeTabs: document.getElementById('mode-tabs'),
  video: document.getElementById('video'),
  overlay: document.getElementById('overlay'),
  hint: document.getElementById('hint'),
  chip: document.getElementById('prediction-chip'),
  predAr: document.getElementById('pred-ar'),
  predEn: document.getElementById('pred-en'),
  predConf: document.getElementById('pred-conf'),
  modeNameEn: document.getElementById('mode-name-en'),
  modeNameAr: document.getElementById('mode-name-ar'),
  modeDesc: document.getElementById('mode-desc'),
  tipBanner: document.getElementById('tip-banner'),
  bufferText: document.getElementById('buffer-text'),
  btnStart: document.getElementById('btn-start'),
  btnBackspace: document.getElementById('btn-backspace'),
  btnClear: document.getElementById('btn-clear'),
};

const state = {
  handLandmarker: null,
  currentMode: MODES[0],
  predictFn: null, // (features:number[]) => {label, confidence} | null
  modelLoadError: null,
  stream: null,
  running: false,
  textBuffer: '',
  lastLabel: null,
  stableCount: 0,
  loopHandle: null,
};

function setStatus(text, kind) {
  els.statusPill.textContent = text;
  els.statusPill.classList.remove('ok', 'err');
  if (kind) els.statusPill.classList.add(kind);
}

// --- Mode tabs -----------------------------------------------------------

function renderModeTabs() {
  els.modeTabs.innerHTML = '';
  MODES.forEach((mode) => {
    const btn = document.createElement('button');
    btn.className = 'mode-tab' + (mode.id === state.currentMode.id ? ' active' : '');
    btn.innerHTML = `<span class="num">${mode.key}</span>${mode.nameEn}`;
    btn.addEventListener('click', () => selectMode(mode));
    els.modeTabs.appendChild(btn);
  });
}

async function selectMode(mode) {
  state.currentMode = mode;
  state.textBuffer = '';
  state.lastLabel = null;
  state.stableCount = 0;
  updateBufferUI();
  renderModeTabs();

  els.modeNameEn.textContent = mode.nameEn;
  els.modeNameAr.textContent = mode.nameAr;
  els.modeDesc.textContent = mode.description;
  els.chip.classList.remove('show');
  els.tipBanner.classList.remove('show');

  state.predictFn = null;
  state.modelLoadError = null;
  try {
    const mod = await import(`./models/model_${mode.id}.js`);
    const fn = mod[`predict_${mode.id}`];
    if (typeof fn !== 'function') throw new Error('model module has no predict function');
    state.predictFn = fn;
    setStatus(`${mode.nameEn}: model ready`, 'ok');
  } catch (err) {
    state.modelLoadError = err;
    setStatus(`${mode.nameEn}: no trained model yet`, 'err');
    console.warn(`[models] ${mode.id} not available yet -- train it, then run convert_models_to_js.py.`, err);
  }
}

// --- Feature extraction (mirrors hand_utils.py exactly) ------------------

function landmarksToFeatures(landmarks) {
  let minX = Infinity;
  let minY = Infinity;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
  }
  const features = [];
  for (const lm of landmarks) {
    features.push(lm.x - minX);
    features.push(lm.y - minY);
  }
  return features;
}

// --- Drawing ---------------------------------------------------------------

function resizeOverlayToVideo() {
  const rect = els.video.getBoundingClientRect();
  els.overlay.width = rect.width;
  els.overlay.height = rect.height;
}

function drawLandmarks(ctx, landmarks, w, h) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(23,195,162,0.9)';
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
  }
  ctx.stroke();

  ctx.fillStyle = '#d4af37';
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateBufferUI() {
  els.bufferText.textContent = state.textBuffer.slice(-80) || '—';
}

function showPrediction(gclass, displayEn, confidence) {
  els.chip.classList.add('show');
  els.predAr.textContent = gclass && gclass.displayAr ? gclass.displayAr : '';
  els.predEn.textContent = displayEn;
  els.predConf.textContent = `${confidence.toFixed(0)}% confidence`;

  if (gclass && gclass.tip) {
    els.tipBanner.textContent = gclass.tip;
    els.tipBanner.classList.add('show');
  } else {
    els.tipBanner.classList.remove('show');
  }
}

// --- Detection loop --------------------------------------------------------

function detectionLoop() {
  if (!state.running) return;

  const now = performance.now();
  if (els.video.readyState >= 2) {
    const result = state.handLandmarker.detectForVideo(els.video, now);
    const ctx = els.overlay.getContext('2d');
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);

    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      drawLandmarks(ctx, landmarks, els.overlay.width, els.overlay.height);

      if (state.predictFn) {
        const features = landmarksToFeatures(landmarks);
        const prediction = state.predictFn(features); // {label, confidence}
        if (prediction) {
          const gclass = lookupClass(state.currentMode, prediction.label);
          const displayEn = gclass ? gclass.displayEn : prediction.label;
          showPrediction(gclass, displayEn, prediction.confidence);

          if (prediction.label === state.lastLabel) {
            state.stableCount += 1;
          } else {
            state.stableCount = 0;
          }
          state.lastLabel = prediction.label;

          if (state.stableCount === STABLE_FRAMES_TO_COMMIT && prediction.confidence >= MIN_CONFIDENCE_TO_COMMIT) {
            state.textBuffer += `${displayEn} `;
            updateBufferUI();
          }
        }
      }
    } else {
      els.chip.classList.remove('show');
      els.tipBanner.classList.remove('show');
      state.lastLabel = null;
      state.stableCount = 0;
    }
  }

  state.loopHandle = requestAnimationFrame(detectionLoop);
}

// --- Camera lifecycle --------------------------------------------------------

async function startCamera() {
  if (!state.handLandmarker) {
    setStatus('loading MediaPipe...', null);
    try {
      if (!visionModule) {
        visionModule = await import(TASKS_VISION_URL);
      }
      const { HandLandmarker, FilesetResolver } = visionModule;
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
      });
    } catch (err) {
      console.error('Failed to load HandLandmarker', err);
      setStatus('could not load MediaPipe -- check your connection', 'err');
      return;
    }
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    console.error('Camera permission/error', err);
    setStatus('camera access denied', 'err');
    return;
  }

  els.video.srcObject = state.stream;
  await els.video.play();
  els.hint.style.display = 'none';
  resizeOverlayToVideo();
  window.addEventListener('resize', resizeOverlayToVideo);

  state.running = true;
  els.btnStart.textContent = 'Stop Camera';
  els.btnStart.classList.add('stop');
  setStatus(state.predictFn ? `${state.currentMode.nameEn}: running` : `${state.currentMode.nameEn}: no trained model yet`, state.predictFn ? 'ok' : 'err');
  detectionLoop();
}

function stopCamera() {
  state.running = false;
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  els.video.srcObject = null;
  els.hint.style.display = 'flex';
  els.chip.classList.remove('show');
  els.tipBanner.classList.remove('show');
  els.btnStart.textContent = 'Start Camera';
  els.btnStart.classList.remove('stop');
  setStatus('camera stopped', null);
}

// --- Wiring ------------------------------------------------------------------

els.btnStart.addEventListener('click', () => {
  if (state.running) stopCamera();
  else startCamera();
});

els.btnBackspace.addEventListener('click', () => {
  let text = state.textBuffer.trimEnd();
  const lastSpace = text.lastIndexOf(' ');
  state.textBuffer = lastSpace >= 0 ? text.slice(0, lastSpace + 1) : '';
  updateBufferUI();
});

els.btnClear.addEventListener('click', () => {
  state.textBuffer = '';
  updateBufferUI();
});

// --- Init ----------------------------------------------------------------------

renderModeTabs();
selectMode(MODES[0]);
updateBufferUI();
setStatus('tap Start Camera', null);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed (offline caching will be unavailable):', err);
    });
  });
}
