/**
 * welcome.js
 * -----------------------------------------------------------------------
 * The opening screen, and the "About" button that brings it back.
 *
 * It shows EVERY time the app opens, which is deliberate. At an exhibition
 * stand a different visitor picks up the phone every few minutes, and
 * opening straight into a live camera view of their own face tells them
 * nothing about what they're holding. One tap gets them past it.
 *
 * It is plain HTML in index.html rather than markup built here, so it is
 * on screen the instant the page paints -- before any JavaScript, before
 * MediaPipe, before a model downloads. On venue wifi that gap can be
 * several seconds, and those are exactly the seconds a visitor decides
 * whether to bother.
 */

const welcome = document.getElementById('welcome');
const startBtn = document.getElementById('welcome-start');
const aboutBtn = document.getElementById('about-toggle');

function closeWelcome() {
  if (!welcome) return;
  welcome.classList.add('gone');
  // Put keyboard focus somewhere sensible rather than leaving it on a
  // button that no longer exists on screen.
  const firstTab = document.getElementById('tab-practice');
  if (firstTab) firstTab.focus();
}

function openWelcome() {
  if (!welcome) return;
  welcome.classList.remove('gone');
  if (startBtn) startBtn.focus();
}

if (startBtn) startBtn.addEventListener('click', closeWelcome);
if (aboutBtn) aboutBtn.addEventListener('click', openWelcome);

// Escape closes it, like any other dialog.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && welcome && !welcome.classList.contains('gone')) {
    closeWelcome();
  }
});

// Tapping the dark area outside the card closes it too.
if (welcome) {
  welcome.addEventListener('click', (e) => {
    if (e.target === welcome) closeWelcome();
  });
}
