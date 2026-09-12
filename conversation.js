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
  clearSignaling, setCaption, listenCaptions, stopListeningCaptions,
} from './room.js';
import { startCall } from './webrtc.js';
import { notifyCommit } from './feedback.js';
import { speakSign, speakText } from './speech.js';
import { videoConstraints } from './camera.js';

// How long (ms) to wait after the last recognized sign before auto-sending
// the draft as a finished message, when Auto-caption is on -- long enough
// that someone fingerspelling a whole word doesn't get cut off mid-word,
// short enough that the other phone still sees it feel "live".
const AUTO_SEND_PAUSE_MS = 2500;

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
  tabQuiz: document.getElementById('tab-quiz'),
  screenPractice: document.getElementById('screen-practice'),
  screenConversation: document.getElementById('screen-conversation'),
  screenQuiz: document.getElementById('screen-quiz'),

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
  btnShowAudienceQr: document.getElementById('conv-btn-audience-qr'),
  audienceQrPanel: document.getElementById('conv-audience-qr'),
  audienceQrBox: document.getElementById('conv-audience-qr-box'),
  btnLeave: document.getElementById('conv-btn-leave'),

  messages: document.getElementById('conv-messages'),

  remoteVideo: document.getElementById('conv-remote-video'),
  callHint: document.getElementById('conv-call-hint'),
  remoteCaption: document.getElementById('conv-remote-caption'),
  btnAutocaption: document.getElementById('conv-btn-autocaption'),

  modeTabs: document.getElementById('conv-mode-tabs'),
  video: document.getElementById('conv-video'),
  overlay: document.getElementById('conv-overlay'),
  hint: document.getElementById('conv-hint'),
  chip: document.getElementById('conv-prediction-chip'),
  predAr: document.getElementById('conv-pred-ar'),
  predEn: document.getElementById('conv-pred-en'),
  predConf: document.getElementById('conv-pred-conf'),
  bufferText: document.getElementById('conv-buffer-text'),
  btnBackspace: document.getElementById('conv-btn-backspace'),
  btnClear: document.getElementById('conv-btn-clear'),
  btnSendSign: document.getElementById('conv-btn-send-sign'),

  textInput: document.getElementById('conv-text-input'),
  btnSendText: document.getElementById('conv-btn-send-text'),

  statusPill: document.getElementById('status-pill'),
};

const state = {
  code: null,
  isCaller: false,
  deviceId: getDeviceId(),
  currentMode: MODES[0],
  predictFn: null,
  handLandmarker: null,
  stream: null,
  callController: null,
  running: false,
  textBuffer: '',
  lastLabel: null,
  stableCount: 0,
  committedThisHold: false,
  loopHandle: null,
  autoCaption: true,
  autoSendTimer: null,
  lastSpokenMsgId: null,
  messagesInitialized: false,
};

function setStatus(text, kind) {
  els.statusPill.textContent = text;
  els.statusPill.classList.remove('ok', 'err');
  if (kind) els.statusPill.classList.add(kind);
}

// --- Screen switching --------------------------------------------------------

function showScreen(name) {
  els.tabPractice.classList.toggle('active', name === 'practice');
  els.tabConversation.classList.toggle('active', name === 'conversation');
  if (els.tabQuiz) els.tabQuiz.classList.toggle('active', name === 'quiz');
  els.screenPractice.hidden = name !== 'practice';
  els.screenConversation.hidden = name !== 'conversation';
  if (els.screenQuiz) els.screenQuiz.hidden = name !== 'quiz';
  document.dispatchEvent(new CustomEvent('app:screen-changed', { detail: { screen: name } }));
}

els.tabPractice.addEventListener('click', () => showScreen('practice'));
els.tabConversation.addEventListener('click', () => showScreen('conversation'));
if (els.tabQuiz) els.tabQuiz.addEventListener('click', () => showScreen('quiz'));

// Front/back camera switch (camera.js). Only the VIDEO track is swapped:
// the microphone keeps running untouched, and the live call stays up --
// replaceVideoTrack() changes what the other phone sees without
// renegotiating the connection. If that isn't possible for some reason,
// the local camera still switches; only the far end keeps the old view.
document.addEventListener('app:camera-changed', async () => {
  if (!state.stream) return;
  let newStream;
  try {
    newStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(),
      audio: false,
    });
  } catch (err) {
    console.error('Could not switch camera', err);
    setStatus('could not switch camera', 'err');
    return;
  }

  const newTrack = newStream.getVideoTracks()[0];
  if (!newTrack) return;

  if (state.callController && state.callController.replaceVideoTrack) {
    try {
      await state.callController.replaceVideoTrack(newTrack);
    } catch (err) {
      console.warn('[conversation] could not send the new camera to the other phone', err);
    }
  }

  const oldTrack = state.stream.getVideoTracks()[0];
  if (oldTrack) {
    state.stream.removeTrack(oldTrack);
    oldTrack.stop();
  }
  state.stream.addTrack(newTrack);
  els.video.srcObject = state.stream;
  await els.video.play().catch(() => {});
  resizeOverlay();
});

document.addEventListener('app:screen-changed', (e) => {
  if (e.detail.screen !== 'conversation') {
    // Only one camera at a time (Practice mode uses its own). Leaving this
    // screen pauses the video call, but keeps chat messages arriving in
    // the background -- it resumes automatically when you come back.
    stopCall();
  } else if (state.code && !state.stream) {
    beginCall();
  }
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
  // handLandmarker may still be loading (or may have failed to load) even
  // though the camera/call is already running -- the video call itself
  // doesn't need it, only sign recognition does.
  if (state.handLandmarker && els.video.readyState >= 2) {
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
            state.committedThisHold = false;
          }
          state.lastLabel = prediction.label;

          // `>=` rather than `===` -- see the long comment in app.js. The
          // original checked confidence on one single frame of the hold, so
          // a correctly-recognised sign that was momentarily just under the
          // threshold never made it into the message.
          if (!state.committedThisHold
              && state.stableCount >= STABLE_FRAMES_TO_COMMIT
              && prediction.confidence >= MIN_CONFIDENCE_TO_COMMIT) {
            state.committedThisHold = true;
            state.textBuffer += (state.textBuffer ? ' ' : '') + displayEn;
            updateBufferUI();
            notifyCommit();
            speakSign(gclass, displayEn);
            onDraftChanged();
          }
        }
      }
    } else {
      els.chip.classList.remove('show');
      state.lastLabel = null;
      state.stableCount = 0;
      state.committedThisHold = false;
    }
  }
  state.loopHandle = requestAnimationFrame(detectionLoop);
}

// --- Camera + live video call --------------------------------------------
//
// Unlike Practice mode (manual Start Camera button), Conversation mode's
// camera turns on AUTOMATICALLY as soon as you start or join a
// conversation, and stays on the whole time -- because that same camera
// feed is now also the live video sent to the other phone (see
// webrtc.js), not just the input to sign recognition. Sign recognition
// (the prediction chip, the draft text buffer) keeps working exactly as
// before, using that same video.

function setCallHint(text) {
  if (!els.callHint) return;
  if (text) {
    els.callHint.textContent = text;
    els.callHint.style.display = 'flex';
  } else {
    els.callHint.style.display = 'none';
  }
}

// --- Live auto-captions ----------------------------------------------------
//
// Normally you build up a draft sign-by-sign and tap Send when ready. With
// Auto-caption ON (the default), every recognized sign is ALSO streamed to
// the other phone immediately as a live caption -- no waiting, no tapping
// Send -- and if you pause signing for a couple of seconds, the draft is
// automatically turned into a real message and the caption clears, ready
// for the next sentence. This is what makes the video call feel like it
// has live captions, instead of a chat box next to it.

function setAutocaptionUI() {
  if (!els.btnAutocaption) return;
  els.btnAutocaption.textContent = state.autoCaption ? 'Auto-caption: On' : 'Auto-caption: Off';
  els.btnAutocaption.classList.toggle('on', state.autoCaption);
}

function onDraftChanged() {
  if (!state.autoCaption || !state.code) return;
  // Broadcast the in-progress draft immediately so the other phone can show
  // it as a streaming caption under the video call.
  setCaption(state.code, state.deviceId, state.textBuffer).catch(() => {});
  // Reset the "they paused signing" timer -- when it fires with no new sign
  // in between, treat the pause as "end of sentence" and send it for real.
  if (state.autoSendTimer) clearTimeout(state.autoSendTimer);
  state.autoSendTimer = setTimeout(() => {
    const text = state.textBuffer.trim();
    if (text) {
      doSend(text);
      state.textBuffer = '';
      updateBufferUI();
      setCaption(state.code, state.deviceId, '').catch(() => {});
    }
  }, AUTO_SEND_PAUSE_MS);
}

function clearAutosendTimer() {
  if (state.autoSendTimer) {
    clearTimeout(state.autoSendTimer);
    state.autoSendTimer = null;
  }
}

if (els.btnAutocaption) {
  els.btnAutocaption.addEventListener('click', () => {
    state.autoCaption = !state.autoCaption;
    setAutocaptionUI();
    if (!state.autoCaption) {
      clearAutosendTimer();
      if (state.code) setCaption(state.code, state.deviceId, '').catch(() => {});
    }
  });
  setAutocaptionUI();
}

function showRemoteCaption(text) {
  if (!els.remoteCaption) return;
  if (text) {
    els.remoteCaption.textContent = text;
    els.remoteCaption.style.display = 'block';
  } else {
    els.remoteCaption.style.display = 'none';
  }
}

async function beginCall() {
  setStatus('starting camera...', null);
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(),
      audio: true,
    });
  } catch (err) {
    console.warn('[conversation] camera+mic failed, trying camera only', err);
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: false,
      });
    } catch (err2) {
      console.error('Camera permission/error', err2);
      setStatus('camera access denied', 'err');
      return;
    }
  }

  els.video.srcObject = state.stream;
  await els.video.play();
  if (els.hint) els.hint.style.display = 'none';
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);
  state.running = true;
  setStatus('conversation: connecting video call...', null);
  detectionLoop();

  if (!state.handLandmarker) {
    try {
      state.handLandmarker = await getHandLandmarker();
    } catch (err) {
      // Sign recognition won't work, but the video call itself doesn't
      // need MediaPipe, so keep going rather than stopping the camera.
      console.error('Failed to load HandLandmarker', err);
    }
  }

  setCallHint("Waiting for the other person's video...");
  try {
    state.callController = await startCall(state.code, state.isCaller, state.stream, {
      onRemoteStream: (remoteStream) => {
        if (els.remoteVideo) {
          els.remoteVideo.srcObject = remoteStream;
          els.remoteVideo.play().catch(() => {});
        }
        setCallHint(null);
      },
      onState: (connState) => {
        if (connState === 'connected') {
          setStatus('conversation: connected', 'ok');
        } else if (connState === 'failed' || connState === 'disconnected') {
          setCallHint('Could not connect the video call -- text/sign messages still work.');
        }
      },
    });
  } catch (err) {
    console.error('[webrtc] could not start call', err);
    setCallHint('Could not start the video call -- text/sign messages still work.');
  }
}

function stopCall() {
  state.running = false;
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  if (state.callController) {
    state.callController.close();
    state.callController = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (els.video) els.video.srcObject = null;
  if (els.remoteVideo) els.remoteVideo.srcObject = null;
  if (els.hint) els.hint.style.display = 'flex';
  if (els.chip) els.chip.classList.remove('show');
  setCallHint(null);
}

els.btnBackspace.addEventListener('click', () => {
  const words = state.textBuffer.split(' ').filter(Boolean);
  words.pop();
  state.textBuffer = words.join(' ');
  updateBufferUI();
  clearAutosendTimer();
  if (state.code) setCaption(state.code, state.deviceId, state.textBuffer).catch(() => {});
});

els.btnClear.addEventListener('click', () => {
  state.textBuffer = '';
  updateBufferUI();
  clearAutosendTimer();
  if (state.code) setCaption(state.code, state.deviceId, '').catch(() => {});
});

els.btnSendSign.addEventListener('click', () => {
  const text = state.textBuffer.trim();
  if (!text) return;
  clearAutosendTimer();
  doSend(text);
  state.textBuffer = '';
  updateBufferUI();
  if (state.code) setCaption(state.code, state.deviceId, '').catch(() => {});
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

  // Read the newest message out loud, but only once, and only if it just
  // arrived from the OTHER phone -- like a live interpreter speaking what
  // was signed. `renderMessages` re-runs with the FULL list every time
  // anything changes, so lastSpokenMsgId stops the same message being
  // spoken again on every re-render.
  const last = list[list.length - 1];
  if (!state.messagesInitialized) {
    // First load of this room's history (e.g. just joined) -- note the
    // newest message so it isn't spoken, but don't announce old history.
    state.messagesInitialized = true;
    state.lastSpokenMsgId = last ? last.id : null;
  } else if (last && !last.system && last.from !== state.deviceId && last.id !== state.lastSpokenMsgId) {
    state.lastSpokenMsgId = last.id;
    speakText(last.text);
  } else if (last) {
    state.lastSpokenMsgId = last.id;
  }
}

// --- Start / Join flow ------------------------------------------------------------

function showRoom(code) {
  state.code = code;
  state.messagesInitialized = false;
  els.convStart.hidden = true;
  els.convRoom.hidden = false;
  els.roomCode.textContent = code;
  renderMessages([]);
  listenMessages(code, renderMessages).catch((err) => {
    console.error(err);
    setStatus('could not connect -- check firebase-config.js', 'err');
  });
  listenCaptions(code, (byDevice) => {
    const theirText = Object.entries(byDevice)
      .filter(([id]) => id !== state.deviceId)
      .map(([, text]) => text)
      .find((text) => text);
    showRemoteCaption(theirText || '');
  }).catch(() => { /* captions are a nice-to-have -- never block the call over this */ });
  beginCall();
}

els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  setStatus('creating conversation...', null);
  try {
    const code = await createRoom();
    state.isCaller = true;
    // Defensive tidy-up in case this exact 4-digit code was used (and left
    // uncleared) a while ago -- very unlikely, but cheap to guard against.
    await clearSignaling(code).catch(() => {});
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
    state.isCaller = false;
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
  const leavingCode = state.code;
  stopListening();
  stopListeningCaptions();
  clearAutosendTimer();
  stopCall();
  if (leavingCode) clearSignaling(leavingCode).catch(() => { /* best-effort tidy-up */ });
  showRemoteCaption('');
  state.code = null;
  state.isCaller = false;
  state.messagesInitialized = false;
  state.lastSpokenMsgId = null;
  els.convRoom.hidden = true;
  els.convStart.hidden = false;
  els.joinForm.hidden = true;
  els.codeInput.value = '';
  qrDesiredVisible = false;
  els.qrPanel.hidden = true;
  qrAudienceDesiredVisible = false;
  if (els.audienceQrPanel) els.audienceQrPanel.hidden = true;
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
    if (qrAudienceDesiredVisible) { qrAudienceDesiredVisible = false; els.audienceQrPanel.hidden = true; }
    showQr(state.code);
  }
});

// --- Audience QR (big-screen live captions) ---------------------------------
//
// A SEPARATE code from the join-with-camera QR above: this one points to
// audience.html, a tiny camera-free page that just shows the conversation's
// messages and live captions in huge text -- built for a projector, or for
// dozens of audience members to scan on their own phones during a live
// demo and follow along, without joining the actual 2-person call. See
// audience.html and README_WEBAPP.md, "The QR audience-participation demo".

let qrAudienceDesiredVisible = false;

async function showAudienceQr(code) {
  try {
    await loadQrLibrary();
    if (!qrAudienceDesiredVisible) return;
    els.audienceQrBox.innerHTML = '';
    const audienceUrl = new URL('audience.html', location.href);
    audienceUrl.searchParams.set('room', code);
    // eslint-disable-next-line no-undef
    new QRCode(els.audienceQrBox, { text: audienceUrl.toString(), width: 180, height: 180 });
    els.audienceQrPanel.hidden = false;
  } catch (err) {
    console.warn('QR code library failed to load for the audience QR.', err);
  }
}

if (els.btnShowAudienceQr) {
  els.btnShowAudienceQr.addEventListener('click', () => {
    if (qrAudienceDesiredVisible) {
      qrAudienceDesiredVisible = false;
      els.audienceQrPanel.hidden = true;
    } else {
      qrAudienceDesiredVisible = true;
      if (qrDesiredVisible) { qrDesiredVisible = false; els.qrPanel.hidden = true; }
      showAudienceQr(state.code);
    }
  });
}

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
