/**
 * conversation.js
 * -----------------------------------------------------------------------
 * "Conversation" screen: two phones, each running this same app, joined
 * to the same room code. Whoever is signing shows their hand to the
 * camera and builds up a message the same way Practice mode does, then
 * taps Send -- the message appears on the OTHER phone's screen in real
 * time. Either side can also just type. See room.js for how the two
 * phones actually talk to each other (a free Firebase project), and
 * firebase-config.js for the one file you must fill in to turn this on.
 */

import { MODES, lookupClass } from './modes.js';
import {
  getHandLandmarker, landmarksToFeatures, drawLandmarks,
  STABLE_FRAMES_TO_COMMIT, MIN_CONFIDENCE_TO_COMMIT,
} from './vision.js';
import {
  getDeviceId, createRoom, roomExists, sendMessage, listenMessages, stopListening,
} from './room.js';

const QR_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
let qrLoadPromise = null;

function loadQrLibrary() {
  if (!qrLoadPromise) {
    qrLoadPromise = new Promise((resolve, reject) => {
      if (window.QRCode) { resolve(); return; }
      const s = document.createElement('script');
      s.src = QR_SCRIPT_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('could not load QR code library'));
      document.head.appendChild(s);
    });
  }
  return qrLoadPromise;
}

const els = {
  tabPractice: document.getElementById('tab-practice'),
  tabConversation: document.getElementById('tab-conversation'),
  screenPractice: document.getElementById('screen-practice'),
  screenConversation: document.getElementById('screen-conversation'),

  convStart: document.getElementById('conv-start'),
  btnStart: document.getElementById('conv-btn-start'),
  btnJoin: document.getElementById('conv-btn-join'),
  joinForm: document.getElementById('conv-join-form'),
  codeInput: document.getElementById('conv-code-input'),
  btnJoinConfirm: document.getElementById('conv-btn-join-confirm'),
  joinError: document.getElementById('conv-join-error'),

  convRoom: document.getElementById('conv-room'),
  roomCode: document.getElementById('conv-room-code'),
  btnShowQr: document.getElementById('conv-btn-qr'),
  qrPanel: document.getElementById('conv-qr'),
  qrBox: document.getElementById('conv-qr-box'),
  btnLeave: document.getElementById('conv-btn-leave'),

  messages: document.getElementById('conv-messages'),

  modeTabs: document.getElementById('conv-mode-tabs'),
  video: document.getElementById('conv-video'),
  overlay: document.getElementById('conv-overlay'),
  hint: document.getElementById('conv-hint'),
  chip: document.getElementById('conv-prediction-chip'),
  predAr: document.getElementById('conv-pred-ar'),
  predEn: document.getElementById('conv-pred-en'),
  predConf: document.getElementById('conv-pred-conf'),
  bufferText: document.getElementById('conv-buffer-text'),
  btnCamera: document.getElementById('conv-btn-camera'),
  btnBackspace: document.getElementById('conv-btn-backspace'),
  btnClear: document.getElementById('conv-btn-clear'),
  btnSendSign: document.getElementById('conv-btn-send-sign'),

  textInput: document.getElementById('conv-text-input'),
  btnSendText: document.getElementById('conv-btn-send-text'),

  statusPill: document.getElementById('status-pill'),
};

const state = {
  code: null,
  deviceId: getDeviceId(),
  currentMode: MODES[0],
  predictFn: null,
  handLandmarker: null,
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

// --- Screen switching --------------------------------------------------------

function showScreen(name) {
  const isConv = name === 'conversation';
  els.tabPractice.classList.toggle('active', !isConv);
  els.tabConversation.classList.toggle('active', isConv);
  els.screenPractice.hidden = isConv;
  els.screenConversation.hidden = !isConv;
  document.dispatchEvent(new CustomEvent('app:screen-changed', { detail: { screen: name } }));
}

els.tabPractice.addEventListener('click', () => showScreen('practice'));
els.tabConversation.addEventListener('click', () => showScreen('conversation'));

document.addEventListener('app:screen-changed', (e) => {
  if (e.detail.screen !== 'conversation') stopConvCamera();
});

// --- Mode tabs for the compose camera (mirrors app.js) ------------------------

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
  els.chip.classList.remove('show');

  state.predictFn = null;
  try {
    const mod = await import(`./models/model_${mode.id}.js`);
    const fn = mod[`predict_${mode.id}`];
    if (typeof fn !== 'function') throw new Error('model module has no predict function');
    state.predictFn = fn;
  } catch (err) {
    console.warn(`[conversation] ${mode.id} model not available yet -- train it, then run convert_models_to_js.py.`, err);
  }
}

function updateBufferUI() {
  els.bufferText.textContent = state.textBuffer || '—';
}

function showPrediction(gclass, displayEn, confidence) {
  els.chip.classList.add('show');
  els.predAr.textContent = gclass && gclass.displayAr ? gclass.displayAr : '';
  els.predEn.textContent = displayEn;
  els.predConf.textContent = `${confidence.toFixed(0)}%`;
}

// --- Detection loop (mirrors app.js) ------------------------------------------

function resizeOverlay() {
  const rect = els.video.getBoundingClientRect();
  els.overlay.width = rect.width;
  els.overlay.height = rect.height;
}

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
        const prediction = state.predictFn(features);
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
            state.textBuffer += (state.textBuffer ? ' ' : '') + displayEn;
            updateBufferUI();
          }
        }
      }
    } else {
      els.chip.classList.remove('show');
      state.lastLabel = null;
      state.stableCount = 0;
    }
  }
  state.loopHandle = requestAnimationFrame(detectionLoop);
}

async function startConvCamera() {
  if (!state.handLandmarker) {
    setStatus('loading MediaPipe...', null);
    try {
      state.handLandmarker = await getHandLandmarker();
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
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);
  state.running = true;
  els.btnCamera.textContent = 'Stop Camera';
  els.btnCamera.classList.add('stop');
  setStatus('conversation: camera running', 'ok');
  detectionLoop();
}

function stopConvCamera() {
  state.running = false;
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (els.video) els.video.srcObject = null;
  if (els.hint) els.hint.style.display = 'flex';
  if (els.chip) els.chip.classList.remove('show');
  if (els.btnCamera) {
    els.btnCamera.textContent = 'Start Camera';
    els.btnCamera.classList.remove('stop');
  }
}

els.btnCamera.addEventListener('click', () => {
  if (state.running) stopConvCamera();
  else startConvCamera();
});

els.btnBackspace.addEventListener('click', () => {
  const words = state.textBuffer.split(' ').filter(Boolean);
  words.pop();
  state.textBuffer = words.join(' ');
  updateBufferUI();
});

els.btnClear.addEventListener('click', () => {
  state.textBuffer = '';
  updateBufferUI();
});

els.btnSendSign.addEventListener('click', () => {
  const text = state.textBuffer.trim();
  if (!text) return;
  doSend(text);
  state.textBuffer = '';
  updateBufferUI();
});

els.btnSendText.addEventListener('click', () => {
  const text = els.textInput.value.trim();
  if (!text) return;
  doSend(text);
  els.textInput.value = '';
});

els.textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.btnSendText.click();
});

async function doSend(text) {
  if (!state.code) return;
  try {
    await sendMessage(state.code, text, state.deviceId, 'You');
  } catch (err) {
    console.error(err);
    alert('Could not send -- check your internet connection and that firebase-config.js is filled in.');
  }
}

// --- Messages list -------------------------------------------------------------

function renderMessages(list) {
  els.messages.innerHTML = '';
  if (list.length === 0) {
    const p = document.createElement('div');
    p.className = 'conv-placeholder';
    p.textContent = 'Share the room code so someone can join, then start signing or typing.';
    els.messages.appendChild(p);
    return;
  }
  list.forEach((msg) => {
    const row = document.createElement('div');
    if (msg.system) {
      row.className = 'conv-msg-system';
      row.textContent = msg.text;
    } else {
      const mine = msg.from === state.deviceId;
      row.className = 'conv-msg ' + (mine ? 'mine' : 'theirs');
      row.textContent = msg.text;
    }
    els.messages.appendChild(row);
  });
  els.messages.scrollTop = els.messages.scrollHeight;
}

// --- Start / Join flow ------------------------------------------------------------

function showRoom(code) {
  state.code = code;
  els.convStart.hidden = true;
  els.convRoom.hidden = false;
  els.roomCode.textContent = code;
  renderMessages([]);
  listenMessages(code, renderMessages).catch((err) => {
    console.error(err);
    setStatus('could not connect -- check firebase-config.js', 'err');
  });
}

els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  setStatus('creating conversation...', null);
  try {
    const code = await createRoom();
    setStatus('conversation ready', 'ok');
    showRoom(code);
    qrDesiredVisible = true;
    showQr(code);
  } catch (err) {
    console.error(err);
    setStatus('could not start conversation', 'err');
    els.joinError.textContent = err.message;
    els.joinError.hidden = false;
  } finally {
    els.btnStart.disabled = false;
  }
});

els.btnJoin.addEventListener('click', () => {
  els.joinForm.hidden = false;
  els.codeInput.focus();
});

async function attemptJoin(code) {
  els.joinError.hidden = true;
  if (!/^\d{4}$/.test(code)) {
    els.joinError.textContent = 'Enter the 4-digit code exactly as shown on the other phone.';
    els.joinError.hidden = false;
    return;
  }
  els.btnJoinConfirm.disabled = true;
  try {
    const exists = await roomExists(code);
    if (!exists) {
      els.joinError.textContent = 'No conversation found with that code. Double check it and try again.';
      els.joinError.hidden = false;
      return;
    }
    setStatus('conversation ready', 'ok');
    showRoom(code);
    await sendMessage(code, 'A new device joined this conversation.', state.deviceId, 'System', true);
  } catch (err) {
    console.error(err);
    els.joinError.textContent = err.message;
    els.joinError.hidden = false;
  } finally {
    els.btnJoinConfirm.disabled = false;
  }
}

els.btnJoinConfirm.addEventListener('click', () => attemptJoin(els.codeInput.value.trim()));
els.codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin(els.codeInput.value.trim());
});

els.btnLeave.addEventListener('click', () => {
  stopListening();
  stopConvCamera();
  state.code = null;
  els.convRoom.hidden = true;
  els.convStart.hidden = false;
  els.joinForm.hidden = true;
  els.codeInput.value = '';
  qrDesiredVisible = false;
  els.qrPanel.hidden = true;
  // Clear the ?room= link so re-visiting the app doesn't try to auto-join again.
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState({}, '', url);
});

// --- QR code -----------------------------------------------------------------------

// Tracks what the user actually wants right now, separately from whether
// the (async, possibly slow) QR library has finished loading -- otherwise
// a quick show-then-hide tap could have the slower "show" call clobber the
// hide once its network request finally resolves.
let qrDesiredVisible = false;

async function showQr(code) {
  try {
    await loadQrLibrary();
    if (!qrDesiredVisible) return; // user changed their mind before this finished loading
    els.qrBox.innerHTML = '';
    const joinUrl = new URL(location.href);
    joinUrl.search = '';
    joinUrl.searchParams.set('room', code);
    // eslint-disable-next-line no-undef -- QRCode is a global added by the script loaded above
    new QRCode(els.qrBox, { text: joinUrl.toString(), width: 180, height: 180 });
    els.qrPanel.hidden = false;
  } catch (err) {
    console.warn('QR code library failed to load -- the room code still works, just share it as text.', err);
  }
}

els.btnShowQr.addEventListener('click', () => {
  if (qrDesiredVisible) {
    qrDesiredVisible = false;
    els.qrPanel.hidden = true;
  } else {
    qrDesiredVisible = true;
    showQr(state.code);
  }
});

// --- Init ---------------------------------------------------------------------------

renderModeTabs();
selectMode(MODES[0]);
updateBufferUI();

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl && /^\d{4}$/.test(roomFromUrl)) {
  showScreen('conversation');
  els.codeInput.value = roomFromUrl;
  attemptJoin(roomFromUrl);
}
