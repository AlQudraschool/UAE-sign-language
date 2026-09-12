/**
 * vision.js
 * -----------------------------------------------------------------------
 * Shared MediaPipe hand-tracking helpers used by BOTH screens:
 *   - app.js          (Practice mode -- one phone, one mode at a time)
 *   - conversation.js (Conversation mode -- sign language becomes a chat
 *                       message sent to a DIFFERENT phone)
 *
 * Keeping this in one file means both screens load and configure
 * MediaPipe in exactly the same way, and -- since getHandLandmarker()
 * caches the loaded model the first time either screen needs it --
 * switching between Practice and Conversation never reloads MediaPipe a
 * second time.
 *
 * Loaded lazily (only when a screen actually starts a camera), same
 * reasoning as before: a blocked/slow MediaPipe CDN should never break
 * the rest of the app.
 */

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// How many frames in a row the same sign has to hold steady, and how
// confident the model has to be, before it "commits" (types the letter/
// word).
export const STABLE_FRAMES_TO_COMMIT = 15; // ~0.5s at a typical camera frame rate

// Confidence needed to commit, as a percentage.
//
// This is deliberately low, and that's safe because of how confidence is
// calculated: it's the share of the forest's votes the winning class got,
// out of 36 possible ASL classes (28 for Arabic). Pure guessing would sit
// around 3%. A letter reading 25% has ~9x more support than chance.
//
// It was 40, which turned out to be too strict in real use: letters the
// model identified CORRECTLY but with modest confidence (a correct "D" at
// 23%, a correct "Y" at 33%) were recognised on screen and then never
// typed. That happens because the training photos were recorded on a
// laptop webcam while the demo runs on a phone held at arm's length --
// the model is right, just less certain from an angle it hasn't seen.
//
// The stability requirement above does most of the filtering: a sign has
// to hold steady for 15 straight frames, which random noise doesn't do.
// If letters still fail to type on your demo phone, lower this to 20. If
// you get wrong letters typing themselves, raise it back towards 35.
export const MIN_CONFIDENCE_TO_COMMIT = 25; // percent

let visionModule = null;
let handLandmarkerPromise = null;

/**
 * Loads (once) and returns the shared HandLandmarker instance. Safe to
 * call from Practice mode, Conversation mode, or both -- the underlying
 * network load only ever happens once per page visit.
 *
 * Throws if the MediaPipe CDN can't be reached; callers should catch
 * this and show a clear status message rather than letting the whole
 * screen break.
 */
export function getHandLandmarker() {
  if (!handLandmarkerPromise) {
    handLandmarkerPromise = (async () => {
      if (!visionModule) {
        visionModule = await import(TASKS_VISION_URL);
      }
      const { HandLandmarker, FilesetResolver } = visionModule;
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
      });
    })().catch((err) => {
      handLandmarkerPromise = null; // allow retrying later (e.g. after reconnecting to the internet)
      throw err;
    });
  }
  return handLandmarkerPromise;
}

// Standard MediaPipe hand-skeleton connections (21 landmarks).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Same math as hand_utils.py: landmarks made relative to the hand's own top-left corner. */
export function landmarksToFeatures(landmarks) {
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

export function drawLandmarks(ctx, landmarks, w, h) {
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
