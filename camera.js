/**
 * camera.js
 * -----------------------------------------------------------------------
 * Front/back camera switching, shared by all three screens (Practice,
 * Conversation and Quiz) so there's one button and one setting for the
 * whole app.
 *
 * WHY THE MIRRORING MATTERS
 * -------------------------
 * The front ("selfie") camera is shown mirrored, because that's what
 * everyone expects when looking at themselves -- raise your right hand and
 * the hand on the right of the screen goes up. The BACK camera must NOT be
 * mirrored: you're filming someone else, and flipping them left-to-right
 * would look wrong and make their signing hard to follow.
 *
 * So switching cameras also switches the mirroring. That's done by setting
 * data-facing="user" or data-facing="environment" on <body>, which
 * styles.css uses to decide whether to flip the video and the hand-skeleton
 * overlay. Both have to flip together or the skeleton won't line up with
 * the hand.
 *
 * This is purely a display change -- MediaPipe reads the real camera frame,
 * not the flipped picture on screen, so recognition works identically
 * either way.
 */

const STORAGE_KEY = 'uae-sign-camera-facing';

let facing = 'user'; // 'user' = front/selfie, 'environment' = back
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'user' || saved === 'environment') facing = saved;
} catch (err) {
  /* private browsing etc -- just use the front camera */
}

function applyBodyAttribute() {
  if (document.body) document.body.dataset.facing = facing;
}

function updateButton() {
  const btn = document.getElementById('camera-toggle');
  if (!btn) return;
  // The label says which camera you're ON, not which you'd switch to.
  btn.textContent = facing === 'user' ? '🤳 Front' : '📷 Back';
  btn.classList.toggle('back', facing === 'environment');
}

/** Which camera is currently selected: 'user' (front) or 'environment' (back). */
export function getFacingMode() {
  return facing;
}

/**
 * The `video` constraints every screen should pass to getUserMedia, so all
 * three ask for the same camera at the same resolution.
 *
 * Note `facingMode` is a plain value, not { exact: ... } -- on a phone with
 * only one camera, or a laptop, "exact" makes getUserMedia fail outright,
 * whereas this way the browser falls back to whatever camera it has.
 */
export function videoConstraints() {
  return { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } };
}

export function setFacingMode(next) {
  if (next !== 'user' && next !== 'environment') return;
  facing = next;
  try {
    localStorage.setItem(STORAGE_KEY, facing);
  } catch (err) {
    /* ignore -- the choice just won't be remembered next visit */
  }
  applyBodyAttribute();
  updateButton();
  // Each screen listens for this and swaps its own camera over, so a
  // running camera (or a live video call) picks up the change immediately.
  document.dispatchEvent(new CustomEvent('app:camera-changed', { detail: { facing } }));
}

export function toggleFacingMode() {
  setFacingMode(facing === 'user' ? 'environment' : 'user');
}

/**
 * Flips the setting back WITHOUT announcing it, for when a screen tried to
 * switch cameras and the phone refused (e.g. a tablet with no rear camera).
 * The screen that calls this is already putting the old camera back itself,
 * so firing app:camera-changed again would just start the whole thing over.
 */
export function revertFacingMode() {
  facing = facing === 'user' ? 'environment' : 'user';
  try {
    localStorage.setItem(STORAGE_KEY, facing);
  } catch (err) {
    /* ignore */
  }
  applyBodyAttribute();
  updateButton();
}

// Wire the shared toggle button once. Module scripts run after the HTML is
// parsed, so the button already exists by the time this runs.
(function initCameraToggle() {
  applyBodyAttribute();
  updateButton();
  const btn = document.getElementById('camera-toggle');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => toggleFacingMode());
  }
})();
