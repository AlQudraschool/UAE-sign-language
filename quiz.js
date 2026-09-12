/**
 * quiz.js
 * -----------------------------------------------------------------------
 * "Quiz" screen: a 60-second, score-as-many-as-you-can game built on top
 * of the same recognizer as Practice mode. Pick a mode, tap Start Quiz,
 * and sign whatever word/letter appears on screen as fast as you can --
 * a hands-on way for visitors and VIPs to try the project themselves
 * instead of just watching a demo. Best score is remembered on this
 * phone (localStorage) so people can try to beat each other.
 *
 * Deliberately reuses vision.js/modes.js/feedback.js/speech.js rather
 * than duplicating any of that logic -- this screen is really just
 * app.js's camera + recognition loop, aimed at a randomly-picked target
 * instead of free typing, with a timer and a score on top.
 */

import { MODES, lookupClass } from './modes.js';
import {
  getHandLandmarker, landmarksToFeatures, drawLandmarks,
  STABLE_FRAMES_TO_COMMIT, MIN_CONFIDENCE_TO_COMMIT,
} from './vision.js';
import { notifyCommit, notifySuccess } from './feedback.js';
import { speakSign } from './speech.js';
import { videoConstraints } from './camera.js';

const ROUND_SECONDS = 60;
const BEST_KEY = 'uae-sign-quiz-best';
const NEXT_TARGET_DELAY_MS = 700; // pause so the "Correct!" flash is actually seen

const els = {
  modeTabs: document.getElementById('quiz-mode-tabs'),
  video: document.getElementById('quiz-video'),
  overlay: document.getElementById('quiz-overlay'),
  hint: document.getElementById('quiz-hint'),
  targetBox: document.getElementById('quiz-target'),
  targetAr: document.getElementById('quiz-target-ar'),
  targetEn: document.getElementById('quiz-target-en'),
  flash: document.getElementById('quiz-flash'),
  score: document.getElementById('quiz-score'),
  timer: document.getElementById('quiz-timer'),
  best: document.getElementById('quiz-best'),
  result: document.getElementById('quiz-result'),
  resultTitle: document.getElementById('quiz-result-title'),
  resultScore: document.getElementById('quiz-result-score'),
  resultBest: document.getElementById('quiz-result-best'),
  btnStart: document.getElementById('quiz-btn-start'),
};

// This screen is optional in older deployments (only present once
// index.html has the Quiz tab/section) -- bail out quietly if it's missing
// rather than throwing and breaking the rest of the app's script loading.
if (els.modeTabs && els.video && els.btnStart) {
  runQuizScreen();
}

function runQuizScreen() {
  const state = {
    handLandmarker: null,
    currentMode: MODES[0],
    predictFn: null,
    stream: null,
    running: false, // camera + round both active
    roundLocked: false, // true briefly right after a correct answer, before the next target appears
    target: null,
    score: 0,
    timeLeft: ROUND_SECONDS,
    countdownHandle: null,
    loopHandle: null,
    lastLabel: null,
    stableCount: 0,
  };

  function getBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
      return 0;
    }
  }

  function setBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch (err) {
      /* fine -- best score just won't persist across visits on this device */
    }
  }

  els.best.textContent = getBest();

  // --- Mode tabs -----------------------------------------------------------

  function renderModeTabs() {
    els.modeTabs.innerHTML = '';
    MODES.forEach((mode) => {
      const btn = document.createElement('button');
      btn.className = 'mode-tab' + (mode.id === state.currentMode.id ? ' active' : '');
      btn.innerHTML = `<span class="num">${mode.key}</span>${mode.nameEn}`;
      btn.disabled = state.running;
      btn.addEventListener('click', () => selectMode(mode));
      els.modeTabs.appendChild(btn);
    });
  }

  async function selectMode(mode) {
    if (state.running) return; // don't swap the model mid-round
    state.currentMode = mode;
    renderModeTabs();
    state.predictFn = null;
    try {
      const mod = await import(`./models/model_${mode.id}.js`);
      const fn = mod[`predict_${mode.id}`];
      if (typeof fn !== 'function') throw new Error('model module has no predict function');
      state.predictFn = fn;
    } catch (err) {
      console.warn(`[quiz] ${mode.id} model not available yet -- train it, then run convert_models_to_js.py.`, err);
    }
  }

  // --- Target word -----------------------------------------------------------

  function pickNextTarget() {
    const classes = state.currentMode.classes;
    let next = classes[Math.floor(Math.random() * classes.length)];
    if (classes.length > 1) {
      while (state.target && next.label === state.target.label) {
        next = classes[Math.floor(Math.random() * classes.length)];
      }
    }
    state.target = next;
    state.lastLabel = null;
    state.stableCount = 0;
    state.roundLocked = false;
    els.targetAr.textContent = next.displayAr || '';
    els.targetEn.textContent = next.displayEn;
    speakSign(next, next.displayEn);
  }

  function flash(kind) {
    els.flash.className = '';
    // eslint-disable-next-line no-unused-expressions -- force reflow so the animation restarts every time
    els.flash.offsetWidth;
    els.flash.classList.add(kind);
  }

  // --- Detection loop --------------------------------------------------------

  function resizeOverlay() {
    const rect = els.video.getBoundingClientRect();
    els.overlay.width = rect.width;
    els.overlay.height = rect.height;
  }

  function detectionLoop() {
    if (!state.running) return;
    const now = performance.now();
    if (state.handLandmarker && els.video.readyState >= 2) {
      const result = state.handLandmarker.detectForVideo(els.video, now);
      const ctx = els.overlay.getContext('2d');
      ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);

      if (result.landmarks && result.landmarks.length > 0 && !state.roundLocked) {
        const landmarks = result.landmarks[0];
        drawLandmarks(ctx, landmarks, els.overlay.width, els.overlay.height);

        if (state.predictFn && state.target) {
          const features = landmarksToFeatures(landmarks);
          const prediction = state.predictFn(features);
          if (prediction) {
            if (prediction.label === state.lastLabel) {
              state.stableCount += 1;
            } else {
              state.stableCount = 0;
            }
            state.lastLabel = prediction.label;

            // `>=` rather than `===` -- see the comment in app.js. A correct
            // answer held steadily now counts as soon as confidence is high
            // enough, instead of only being checked on one single frame.
            if (state.stableCount >= STABLE_FRAMES_TO_COMMIT && prediction.confidence >= MIN_CONFIDENCE_TO_COMMIT) {
              if (prediction.label === state.target.label) {
                state.roundLocked = true;
                state.score += 1;
                els.score.textContent = state.score;
                notifySuccess();
                flash('correct');
                setTimeout(() => {
                  if (state.running) pickNextTarget();
                }, NEXT_TARGET_DELAY_MS);
              } else {
                notifyCommit();
                flash('miss');
                state.stableCount = 0; // let them try again immediately
              }
            }
          }
        }
      } else if (!result.landmarks || result.landmarks.length === 0) {
        state.lastLabel = null;
        state.stableCount = 0;
      }
    }
    state.loopHandle = requestAnimationFrame(detectionLoop);
  }

  // --- Round lifecycle ---------------------------------------------------------

  async function startQuiz() {
    els.result.hidden = true;
    if (!state.handLandmarker) {
      els.hint.style.display = 'flex';
      els.hint.textContent = 'loading MediaPipe...';
      try {
        state.handLandmarker = await getHandLandmarker();
      } catch (err) {
        console.error('Failed to load HandLandmarker', err);
        els.hint.textContent = 'could not load MediaPipe -- check your connection';
        return;
      }
    }

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: false,
      });
    } catch (err) {
      console.error('Camera permission/error', err);
      els.hint.style.display = 'flex';
      els.hint.textContent = 'camera access denied';
      return;
    }

    els.video.srcObject = state.stream;
    await els.video.play();
    els.hint.style.display = 'none';
    resizeOverlay();
    window.addEventListener('resize', resizeOverlay);

    state.running = true;
    state.score = 0;
    state.timeLeft = ROUND_SECONDS;
    els.score.textContent = '0';
    els.timer.textContent = String(ROUND_SECONDS);
    els.btnStart.textContent = 'Stop Quiz';
    els.targetBox.classList.add('show');
    renderModeTabs(); // disable mode switching mid-round

    pickNextTarget();
    detectionLoop();

    state.countdownHandle = setInterval(() => {
      state.timeLeft -= 1;
      els.timer.textContent = String(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) endQuiz(false);
    }, 1000);
  }

  /** `silent` = true when leaving the Quiz screen mid-round (no results popup, just stop). */
  function endQuiz(silent) {
    const finalScore = state.score;
    state.running = false;
    state.roundLocked = false;
    if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
    if (state.countdownHandle) clearInterval(state.countdownHandle);
    state.countdownHandle = null;
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    els.video.srcObject = null;
    els.targetBox.classList.remove('show');
    els.hint.style.display = 'flex';
    els.hint.textContent = 'Tap Start Quiz below to begin. Allow camera access when your browser asks.';
    els.btnStart.textContent = 'Start Quiz';
    renderModeTabs();

    if (!silent) {
      const oldBest = getBest();
      const best = Math.max(oldBest, finalScore);
      setBest(best);
      els.best.textContent = best;
      els.resultTitle.textContent = finalScore > 0 && finalScore > oldBest ? 'New best score!' : "Time's up!";
      els.resultScore.textContent = finalScore;
      els.resultBest.textContent = best;
      els.result.hidden = false;
    }
  }

  els.btnStart.addEventListener('click', () => {
    if (state.running) endQuiz(true);
    else startQuiz();
  });

  document.addEventListener('app:screen-changed', (e) => {
    if (e.detail.screen !== 'quiz' && state.running) endQuiz(true);
  });

  // Front/back camera switch -- swap the stream over without ending the
  // round, so nobody loses their score mid-game.
  document.addEventListener('app:camera-changed', async () => {
    if (!state.running) return;
    const previous = state.stream;
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: false,
      });
    } catch (err) {
      console.error('Could not switch camera', err);
      state.stream = previous;
      return;
    }
    if (previous) previous.getTracks().forEach((t) => t.stop());
    els.video.srcObject = state.stream;
    await els.video.play().catch(() => {});
    resizeOverlay();
  });

  renderModeTabs();
  selectMode(MODES[0]);
}
