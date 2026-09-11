/**
 * room.js
 * -----------------------------------------------------------------------
 * Lets two phones -- each running this same web app -- exchange chat
 * messages in real time, using a free Firebase Realtime Database project
 * as the go-between. This is what makes Conversation mode possible:
 * recognizing a sign on Phone A and having it show up on Phone B needs
 * the two phones to talk to each other over the internet, and that's
 * what this file (plus your own Firebase project, see
 * firebase-config.js) provides.
 *
 * Firebase is loaded lazily -- only the first time Conversation mode
 * actually needs it -- the same reasoning as vision.js and the original
 * MediaPipe loading: a blocked/slow Firebase CDN should never break
 * Practice mode.
 */

import { FIREBASE_CONFIG } from './firebase-config.js';

const FIREBASE_SDK_VERSION = '10.13.0';
const SCRIPTS = [
  `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-database-compat.js`,
];

let dbPromise = null;
let messagesRef = null;
let messagesCallback = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}

function configLooksFilledIn() {
  return (
    FIREBASE_CONFIG &&
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.databaseURL &&
    !FIREBASE_CONFIG.apiKey.startsWith('PASTE_') &&
    !FIREBASE_CONFIG.databaseURL.startsWith('PASTE_')
  );
}

/** Loads the Firebase SDK and connects, once. Throws a clear error if it can't. */
function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      if (!configLooksFilledIn()) {
        throw new Error(
          'firebase-config.js has not been filled in yet. See webapp/README_WEBAPP.md, ' +
          '"Setting up Conversation mode", to create a free Firebase project and paste its ' +
          'settings into that file.'
        );
      }
      for (const src of SCRIPTS) {
        // eslint-disable-next-line no-await-in-loop
        await loadScript(src);
      }
      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        window.firebase.initializeApp(FIREBASE_CONFIG);
      }
      return window.firebase.database();
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
}

/** This browser's own random device id, so "my" messages can be told apart from "theirs". */
export function getDeviceId() {
  let id = localStorage.getItem('uae-sign-device-id');
  if (!id) {
    id = 'device-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('uae-sign-device-id', id);
  }
  return id;
}

/** Creates a brand-new room and returns its 4-digit code. */
export async function createRoom() {
  const db = await getDatabase();
  let code = randomCode();
  // Extremely unlikely to collide, but check anyway and re-roll a few times if so.
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await roomExistsOn(db, code);
    if (!exists) break;
    code = randomCode();
  }
  await db.ref(`rooms/${code}/createdAt`).set(window.firebase.database.ServerValue.TIMESTAMP);
  return code;
}

async function roomExistsOn(db, code) {
  const snap = await db.ref(`rooms/${code}/createdAt`).once('value');
  return snap.exists();
}

/** Checks whether a room code actually exists before joining it. */
export async function roomExists(code) {
  const db = await getDatabase();
  return roomExistsOn(db, code);
}

/** Sends one chat message into a room. Set `system: true` for join/leave-type announcements. */
export async function sendMessage(code, text, fromId, fromLabel, system = false) {
  const db = await getDatabase();
  await db.ref(`rooms/${code}/messages`).push({
    text,
    from: fromId,
    fromLabel: fromLabel || 'Someone',
    system,
    ts: window.firebase.database.ServerValue.TIMESTAMP,
  });
}

/** Starts listening for all messages in a room; callback gets the full ordered list each time it changes. */
export async function listenMessages(code, callback) {
  const db = await getDatabase();
  stopListening();
  messagesRef = db.ref(`rooms/${code}/messages`).orderByChild('ts');
  messagesCallback = (snap) => {
    const list = [];
    snap.forEach((child) => {
      list.push({ id: child.key, ...child.val() });
    });
    callback(list);
  };
  messagesRef.on('value', messagesCallback);
}

export function stopListening() {
  if (messagesRef && messagesCallback) {
    messagesRef.off('value', messagesCallback);
  }
  messagesRef = null;
  messagesCallback = null;
}

// --- Signaling helpers for webrtc.js (live video calls) --------------------
//
// These don't know anything about video calls themselves -- they just read
// and write small pieces of connection info under rooms/{code}/webrtc/...
// in the same Firebase project, which webrtc.js uses to help the two
// phones find each other before the actual video/audio starts flowing
// directly between them.

function webrtcRef(db, code, path) {
  return db.ref(`rooms/${code}/webrtc/${path}`);
}

/** Overwrites one signaling value (e.g. the offer or answer). */
export async function setSignal(code, path, data) {
  const db = await getDatabase();
  await webrtcRef(db, code, path).set(data);
}

/** Adds one item to a signaling list (e.g. one ICE candidate). */
export async function pushSignal(code, path, data) {
  const db = await getDatabase();
  await webrtcRef(db, code, path).push(data);
}

/** Calls back with a value every time it changes (or null if it's not set yet). Returns an unsubscribe function. */
export async function listenSignalValue(code, path, callback) {
  const db = await getDatabase();
  const ref = webrtcRef(db, code, path);
  const cb = (snap) => callback(snap.exists() ? snap.val() : null);
  ref.on('value', cb);
  return () => ref.off('value', cb);
}

/** Calls back once for each item already in a list, and again for each new one added. Returns an unsubscribe function. */
export async function listenSignalChildren(code, path, callback) {
  const db = await getDatabase();
  const ref = webrtcRef(db, code, path);
  const cb = (snap) => callback(snap.val());
  ref.on('child_added', cb);
  return () => ref.off('child_added', cb);
}

/** Clears out any old offer/answer/candidates for a room before starting a fresh call. */
export async function clearSignaling(code) {
  const db = await getDatabase();
  await db.ref(`rooms/${code}/webrtc`).remove();
}
