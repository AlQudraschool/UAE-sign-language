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
 * THREE BUGS THIS FILE USED TO HAVE, and why the Arabic mode was silent:
 *
 *   1. We spoke the bare letter glyph. `displayAr` for Arabic Sign Language
 *      is a single character -- "ا" -- and text-to-speech engines say
 *      NOTHING for a lone letter. modes.js now carries `speakAr` with the
 *      letter's spoken name ("ألف") and we use that when it exists.
 *
 *   2. We called speak() in the same tick as cancel(). On Android Chrome
 *      that reliably drops the utterance, so whichever half came second --
 *      the Arabic half -- vanished. We now cancel, then speak on the next
 *      timer tick, and chain the second utterance off the first one's
 *      `onend` instead of queueing both at once.
 *
 *   3. We read the voice list too early. getVoices() returns an EMPTY array
 *      on first call in Chrome until the `voiceschanged` event fires, so
 *      pickVoice() found no Arabic voice, left `utter.voice` unset, and some
 *      Android builds then read Arabic text with an English voice, which
 *      produces silence. We now prime the list and re-read it every time.
 *
 * REMAINING HONEST LIMITATION: if a phone genuinely has no Arabic voice
 * installed, nothing here can conjure one. `hasArabicVoice()` reports that
 * so the UI can say so rather than appearing broken -- test the demo phone,
 * and if it has no Arabic voice, install one from the system settings
 * (Android: Settings > Languages & input > Text-to-speech).
 */

const STORAGE_KEY = 'uae-sign-voice-enabled';
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let enabled = true;
try {
  enabled = supported && localStorage.getItem(STORAGE_KEY) !== 'off';
} catch (err) {
  /* localStorage can be unavailable (e.g. private browsing) -- default to on */
}

/* ------------------------------------------------------------------ voices */

let voiceCache = [];

function refreshVoices() {
  if (!supported) return;
  const list = window.speechSynthesis.getVoices();
  if (list && list.length) voiceCache = list;
}

/** Best voice for a language prefix ('en' / 'ar'), or null if none installed. */
function pickVoice(langPrefix) {
  if (!supported) return null;
  refreshVoices();
  const wanted = langPrefix.toLowerCase();
  // Prefer a local (offline) voice -- on a phone at an exhibition, a
  // network voice is the one that fails when the wifi is busy.
  const matches = voiceCache.filter(
    (v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(wanted)
  );
  if (!matches.length) return null;
  return matches.find((v) => v.localService) || matches[0];
}

export function hasArabicVoice() {
  return pickVoice('ar') !== null;
}

/* ----------------------------------------------------------------- speaking */

/**
 * Speaks a list of [text, lang] pairs one after another.
 *
 * Deliberately chained through `onend` rather than queued: queueing two
 * utterances in different languages back-to-back is exactly the case Android
 * Chrome drops, and it was why the Arabic half never played.
 */
function speakSequence(parts) {
  if (!supported || !enabled || !parts.length) return;

  window.speechSynthesis.cancel();

  const next = (i) => {
    if (i >= parts.length) return;
    const [text, lang] = parts[i];
    if (!text) { next(i + 1); return; }

    const utter = new SpeechSynthesisUtterance(String(text));
    utter.lang = lang;
    const voice = pickVoice(lang.split('-')[0]);
    if (voice) utter.voice = voice;
    utter.rate = 0.95;

    let moved = false;
    const go = () => { if (!moved) { moved = true; next(i + 1); } };
    utter.onend = go;
    utter.onerror = go;
    // Belt and braces: if the engine never fires onend (it happens), don't
    // strand the rest of the sequence.
    setTimeout(go, 2600);

    window.speechSynthesis.speak(utter);
  };

  // A short gap after cancel() -- speaking in the same tick as a cancel is
  // silently dropped on Android Chrome.
  setTimeout(() => next(0), 60);
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
  if (!on && supported) window.speechSynthesis.cancel();
  updateButton();
}

/**
 * Speaks a recognized sign out loud.
 *
 * Arabic goes FIRST when the sign has an Arabic form. If you are in Arabic
 * mode, the Arabic is the answer you are waiting for -- hearing "Alef" before
 * "ألف" made the app feel like an English app with a translation bolted on.
 *
 * `speakAr` (the letter's NAME) is used in preference to `displayAr` (the
 * letter glyph), because a glyph on its own is silent. Modes whose Arabic is
 * already a real word -- Essential Needs, UAE Etiquette -- have no `speakAr`
 * and fall through to `displayAr`, which speaks correctly as-is.
 */
export function speakSign(gclass, displayEn) {
  if (!enabled || !supported) return;
  const arabic = gclass && (gclass.speakAr || gclass.displayAr);
  const parts = [];
  if (arabic) parts.push([arabic, 'ar-SA']);
  if (displayEn) parts.push([displayEn, 'en-US']);
  speakSequence(parts);
}

/** Speaks an arbitrary line of text out loud (incoming Conversation messages). */
export function speakText(text, lang = 'en-US') {
  if (!enabled || !supported || !text) return;
  speakSequence([[text, lang]]);
}

/* -------------------------------------------------------------- the button */

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
  btn.title = hasArabicVoice()
    ? 'Reads recognized signs and messages out loud, in English and Arabic'
    : 'Reads signs out loud. This phone has no Arabic voice installed, '
      + 'so only the English half will be heard.';
}

// Wire the shared toggle button once. Module scripts run after the HTML is
// parsed (same timing as a `defer` script), so the button already exists
// in the DOM by the time this runs -- no need to wait for DOMContentLoaded.
(function initToggleButton() {
  refreshVoices();
  updateButton();

  const btn = document.getElementById('voice-toggle');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => setVoiceOn(!enabled));
  }

  if (supported) {
    // Chrome builds the voice list asynchronously. Listen for it, and also
    // poll briefly, because a few Android builds never fire the event.
    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        refreshVoices();
        updateButton();
      });
    }
    let tries = 0;
    const timer = setInterval(() => {
      refreshVoices();
      tries += 1;
      if (voiceCache.length || tries > 20) {
        clearInterval(timer);
        updateButton();
      }
    }, 250);
  }
})();
