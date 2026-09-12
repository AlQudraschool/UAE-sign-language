/**
 * audience.js
 * -----------------------------------------------------------------------
 * Powers audience.html -- a tiny, camera-free page built for the QR-code
 * live-audience-participation demo. It joins the SAME Conversation-mode
 * room as the presenter's phone (read-only: it only listens, it never
 * sends anything) and displays whatever is being signed as huge,
 * big-screen-friendly captions, updating live as the presenter signs.
 *
 * Two ways to use it at the competition:
 *   1. Project this page itself on the venue's screen behind the
 *      presenter, so the whole audience can read the captions as they
 *      watch the demo.
 *   2. Let individual audience members scan the "Audience QR" code (shown
 *      in the Conversation-mode room, next to the regular join QR code)
 *      on their OWN phones -- they get this same live-caption view
 *      without installing anything or needing a camera.
 *
 * Deliberately reuses room.js (not a copy of it), so this page always
 * agrees with the main app about how messages/captions work.
 */

import { listenMessages, listenCaptions } from './room.js';

const els = {
  code: document.getElementById('a-code'),
  status: document.getElementById('a-status'),
  live: document.getElementById('a-live'),
  history: document.getElementById('a-history'),
};

const code = new URLSearchParams(location.search).get('room');

function renderHistory(list) {
  els.history.innerHTML = '';
  list
    .filter((m) => !m.system)
    .slice(-6)
    .forEach((m) => {
      const row = document.createElement('div');
      row.className = 'a-history-row';
      row.textContent = m.text;
      els.history.appendChild(row);
    });
  els.history.scrollTop = els.history.scrollHeight;
}

function renderLive(byDevice) {
  const text = Object.values(byDevice).find((t) => t) || '';
  if (text) {
    els.live.textContent = text;
    els.live.classList.add('show');
  } else {
    els.live.classList.remove('show');
  }
}

if (!code || !/^\d{4}$/.test(code)) {
  els.status.textContent = 'No conversation code in the link -- ask the presenter for the Audience QR code and scan that instead.';
} else {
  els.code.textContent = code;
  els.status.textContent = 'Connecting...';
  Promise.all([
    listenMessages(code, (list) => {
      els.status.textContent = 'Connected -- watching live';
      renderHistory(list);
    }),
    listenCaptions(code, renderLive),
  ]).catch((err) => {
    console.error(err);
    els.status.textContent = 'Could not connect -- check firebase-config.js, or ask the presenter to check their connection.';
  });
}
