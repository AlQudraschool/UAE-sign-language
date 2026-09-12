/**
 * feedback.js
 * -----------------------------------------------------------------------
 * Tiny "it worked!" feedback for the moment a sign is successfully
 * recognized and committed: a short phone vibration (if the device
 * supports it) plus a short beep (synthesized with the Web Audio API --
 * no sound file to download, so this works instantly, even offline).
 *
 * Used by app.js (Practice mode), conversation.js (Conversation mode),
 * and quiz.js (Quiz mode) -- one shared place so all three screens sound
 * and feel exactly the same.
 */

let audioCtx = null;

function getAudioCtx() {
  // Browsers only allow creating/resuming an AudioContext after a user
  // gesture (a tap), which every screen already has by the time this is
  // called (Start Camera / Start Quiz), so this is safe to create lazily.
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Plays a short, pleasant beep. `variant` picks the tone:
 *  - 'commit' (default): a single short blip -- a sign was recognized and typed.
 *  - 'success': a quick rising two-note chime -- a Quiz-mode correct answer.
 */
function playBeep(variant = 'commit') {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const notes = variant === 'success' ? [660, 990] : [520];
    let t = ctx.currentTime;
    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
      t += 0.09;
    });
  } catch (err) {
    // Never let a feedback beep break the actual recognition flow.
    console.warn('[feedback] beep failed', err);
  }
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (err) {
    /* not supported on this device -- fine, sound/visual feedback still happens */
  }
}

/** Call this the instant a sign is recognized and committed to the text. */
export function notifyCommit() {
  vibrate(35);
  playBeep('commit');
}

/** Call this on a Quiz-mode correct answer -- a slightly bigger, happier cue. */
export function notifySuccess() {
  vibrate([25, 40, 60]);
  playBeep('success');
}
