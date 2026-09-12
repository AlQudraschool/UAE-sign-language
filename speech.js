/**
 * speech.js
 * -----------------------------------------------------------------------
 * Spoken voice output -- reads recognized signs (and incoming Conversation
 * messages) out loud, in English and Arabic, using the browser's built-in
 * `speechSynthesis` API. No external service, no API key, no cost, and it
 * keeps working with no internet connection on most phones (the voices
 * are installed as part of the OS/browser).
 *
 * Shared by app.js (Practice), conversation.js (Conversation), and
 * quiz.js (Quiz) -- one voice on/off toggle for the whole app, wired here
 * once against the "#voice-toggle" button in the top bar (see index.html).
 *
 * HONEST LIMITATION: Arabic voice quality/availability varies a lot by
 * device and browser. Most modern Android/Chrome and iOS/Safari devices
 * ship an Arabic voice out of the box, but a few don't -- if a phone has
 * no Arabic voice installed, the browser silently falls back to reading
 * the Arabic text with whatever default voice it has (often skipped
 * instead), while the English half always works normally. Worth testing
 * on the exact demo phone before the competition.
 */

const STORAGE_KEY = 'uae-sign-voice-enabled';
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let enabled = true;
try {
  enabled = supported && localStorage.getItem(STORAGE_KEY) !== 'off';
} catch (err) {
  /* localStorage can be unavailable (e.g. private browsing) -- default to on */
}

function updateButton() {
  const btn = document.getElementById('voice-toggle');
  if (!btn) return;
  if (!supported) {
    btn.textContent = '🔇 Voice unsupported';
    btn.disabled = true;
    return;
  }
  btn.textContent = enabled ? '🔊 Voice: On' : '🔇 Voice: Off';
  btn.classList.toggle('on', enabled);
}

function pickVoice(langPrefix) {
  if (!supported) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix)) || null;
}

function speakOne(text, lang) {
  if (!supported || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  const voice = pickVoice(lang.split('-')[0]);
  if (voice) utter.voice = voice;
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

export function isVoiceSupported() {
  return supported;
}

export function isVoiceOn() {
  return enabled;
}

export function setVoiceOn(on) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch (err) {
    /* ignore -- toggle still works for the rest of this session */
  }
  updateButton();
}

/**
 * Speaks a recognized sign's word out loud: the English word always, and
 * the Arabic word too if this class has one (Arabic Sign Language,
 * Essential Needs, UAE Etiquette all do) -- so a single committed sign
 * gets announced bilingually, which is exactly the kind of thing that
 * reads as "wow" live in front of an audience.
 */
export function speakSign(gclass, displayEn) {
  if (!enabled || !supported) return;
  window.speechSynthesis.cancel(); // don't let a fast fingerspeller queue up a backlog
  speakOne(displayEn, 'en-US');
  if (gclass && gclass.displayAr) {
    speakOne(gclass.displayAr, 'ar-SA');
  }
}

/** Speaks an arbitrary line of English text out loud (used for incoming Conversation messages). */
export function speakText(text) {
  if (!enabled || !supported || !text) return;
  window.speechSynthesis.cancel();
  speakOne(text, 'en-US');
}

// Wire the shared toggle button once. Module scripts run after the HTML is
// parsed (same timing as a `defer` script), so the button already exists
// in the DOM by the time this runs -- no need to wait for DOMContentLoaded.
(function initToggleButton() {
  updateButton();
  const btn = document.getElementById('voice-toggle');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => setVoiceOn(!enabled));
  }
  // Some browsers (notably Chrome) load their voice list asynchronously;
  // re-check availability once it's ready so the button label is accurate.
  if (supported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = updateButton;
  }
})();
