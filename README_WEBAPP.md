# UAE Sign Language Recognition — Mobile Web App

This turns the desktop Python project into something that runs **in a
phone's browser** on both Android and iPhone — no app store, no Mac,
no Xcode/Android Studio needed. You (or a judge) open a web link on a
phone, allow camera access, and it works like an installed app.

## How it fits together

```
Your computer (Python, unchanged)          Your phone (this folder)
------------------------------------       ------------------------------------
collect_imgs.py     -> photos               index.html / app.js  -> camera UI
create_dataset.py   -> landmark dataset     MediaPipe Tasks (Web) -> hand tracking
train_classifier.py -> model_<mode>.p       model_<mode>.js        -> the SAME
convert_models_to_js.py  ---------------->  (in models/)             Random Forest,
   (new step, described below)                                       converted to JS
```

You still collect data and train models on your computer exactly as
before — nothing about `collect_imgs.py`, `create_dataset.py`, or
`train_classifier.py` changes. The only new step is
**`convert_models_to_js.py`**, which turns a trained `model_<mode>.p`
into a JavaScript file the browser can run directly, with no Python and
no server involved at recognition time. Hand tracking on the phone uses
Google's official **MediaPipe Tasks for Web** (the browser/JavaScript
version of the same MediaPipe library `mediapipe.solutions.hands` uses
on desktop) — same 21 hand landmarks, same idea, different SDK because
the desktop Python API doesn't run in a browser.

Everything runs **on the phone itself** — the camera video is never
uploaded anywhere. The one exception is **Conversation mode** (see
below): to send a recognized message from one phone to a *different*
phone in real time -- and now also to show a **live video call** between
the two phones -- the two phones need to talk to each other over the
internet. Text/sign messages travel through your own free Firebase
project; the live video/audio itself travels directly phone-to-phone
(Firebase is only used to help the two phones find each other, using the
standard WebRTC technology every browser has built in -- no extra
service or cost). Nothing about Practice mode (the original single-phone
camera screen) needs any of this.

## What's in this folder

```
webapp/
  index.html            the app's screens (Practice + Conversation + Quiz)
  audience.html          camera-free "big screen" live captions page --
                         see "The QR audience-participation demo" below
  styles.css            styling
  app.js                Practice mode: camera + recognition + UI logic
  vision.js             shared MediaPipe loading/detection code, used
                         by app.js, conversation.js, and quiz.js
  conversation.js        Conversation mode: room create/join, chat UI,
                         camera compose panel, live captions
  quiz.js                 Quiz mode: 60-second sign-the-word game
  audience.js             logic for audience.html (read-only, no camera)
  room.js                talks to Firebase so two phones can message
                         each other in real time (used by conversation.js
                         and audience.js)
  webrtc.js               sets up the live video call between the two
                         phones (used by conversation.js, via room.js)
  speech.js                spoken voice output (English + Arabic), and
                         the shared "Voice: On/Off" toggle button
  feedback.js              vibration + beep feedback on a recognized sign
  firebase-config.js     PASTE YOUR OWN FIREBASE PROJECT'S SETTINGS HERE
                         -- the only file Conversation mode needs edited
  modes.js               JS copy of ../modes.py's class/label data
  manifest.json           makes the app installable ("Add to Home Screen")
  service-worker.js       caches the app shell so it still opens offline
  icons/                  app icons
  models/                  EMPTY until you run convert_models_to_js.py --
                           model_asl.js, model_arsl.js, etc. go here
```

`convert_models_to_js.py` lives one level up, alongside the rest of the
Python project (`modes.py`, `train_classifier.py`, etc.), since it needs
to import `modes.py` and read the `.p` model files sitting next to it.

## Step 1 — Train at least one mode

If you haven't already, follow the desktop project's normal steps for at
least ASL (it's the fastest to demo-test since you already know the
gestures):

```
python collect_imgs.py
python create_dataset.py
python train_classifier.py
```

This produces `model_asl.p` in the project's root folder (next to
`webapp/`). Repeat for `arsl`, `needs`, `etiquette` when you have time —
you do not need all four before moving on, the app just shows "no
trained model yet" for any mode you haven't converted.

## Step 2 — Convert the trained model(s) to JavaScript

In the same terminal / conda environment you used for training, from the
project's root folder (the one that contains `webapp/`):

```
pip install m2cgen
python convert_models_to_js.py
```

You should see it print each mode's class list and write files into
`webapp/models/`. Re-run this **any time you retrain** — it always
overwrites the old JS file.

## Step 3 — Test it on your own computer first

Browsers block camera access and ES module imports on plain
`file://` pages, so you need a tiny local server (this does not install
anything or need internet — it just serves the folder):

```
cd webapp
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser **on that same
computer** and click **Start Camera**. This proves the app itself
works before you put it online. Press `F12` (or right-click → Inspect →
Console) if something looks wrong — the console will show a red error
message you can search for or share.

Stop the server with `Ctrl+C` when you're done.

## Step 4 — Set up Conversation mode (optional, but recommended)

Conversation mode is the feature where one phone signs and the message
appears on a *different* phone in real time -- like texting, but in sign
language. It needs a free "message relay" so the two phones can find each
other, which you get from Google's **Firebase** (no cost, no credit card).
Skip this step if you only want the original single-phone Practice mode;
everything else in this guide still works without it.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and sign in with any Google account.
2. Click **Add project** (or **Create a project**). Give it any name,
   e.g. `uae-sign-language`. If it asks about Google Analytics, you can
   turn it off -- this project doesn't need it. Click **Create project**
   and wait for it to finish.
3. In the left-hand menu, click **Build** → **Realtime Database**.
4. Click **Create Database**. Pick any location (the default is fine),
   then choose **Start in test mode** and click **Enable**.
5. Click the **Rules** tab (next to "Data") near the top of that page.
   Delete everything in the box and paste this in exactly:
   ```json
   {
     "rules": {
       "rooms": {
         "$room": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
   Click **Publish**. (This keeps write access limited to conversation
   rooms only, instead of the whole database -- still simple enough for
   a short school project, just a bit safer than leaving it wide open.)
6. Click the **gear icon** next to "Project Overview" (top-left) →
   **Project settings**.
7. Scroll down to **Your apps**. Click the **`</>`** (web) icon to
   register a new web app. Give it any nickname (e.g. `webapp`), leave
   the other checkboxes alone, and click **Register app**.
8. You'll now see a block of code containing something like
   `const firebaseConfig = { apiKey: "...", ... }`. Open
   `webapp/firebase-config.js` on your computer in a text editor (right-click
   → **Open with** → **Notepad**, or any code editor), and replace each
   `PASTE_..._HERE` value with the matching value shown on the Firebase
   page (`apiKey`, `authDomain`, `databaseURL`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId`). Keep the quote marks.
   Save the file.

That's it -- Conversation mode is ready. It gets uploaded to GitHub
Pages along with everything else in Step 5.

## Step 5 — Put it online (GitHub Pages, free, no Mac needed)

GitHub Pages gives any repo a free `https://` web address, which is
required for camera access to work on a phone (phones block camera
access on plain `http://`). Everything below is done in a normal web
browser — no command line required.

1. Go to [github.com](https://github.com) and create a free account if
   you don't have one.
2. Click the **+** in the top-right corner → **New repository**. Give
   it a name (e.g. `uae-sign-language`), leave it **Public**, and click
   **Create repository**.
3. On the new repo's page, click **Add file → Upload files**.
4. Open this `webapp` folder on your computer and drag **all of its
   contents** (`index.html`, `audience.html`, `styles.css`, `app.js`,
   `vision.js`, `conversation.js`, `quiz.js`, `audience.js`, `room.js`,
   `webrtc.js`, `speech.js`, `feedback.js`, `firebase-config.js`,
   `modes.js`, `manifest.json`, `service-worker.js`, the `icons` folder,
   and the `models` folder) into the upload area — the files need to sit
   at the **root** of the repo, not inside an extra `webapp` folder.
5. Scroll down and click **Commit changes**.
6. Go to the repo's **Settings** tab → **Pages** (left sidebar).
7. Under "Build and deployment", set **Source** to **Deploy from a
   branch**, branch **main**, folder **/ (root)**, then **Save**.
8. Wait about a minute, then refresh the Pages settings page — it will
   show your live URL, something like
   `https://your-username.github.io/uae-sign-language/`.

## Step 6 — Open it on your phone

Open that `https://...` link in Safari (iPhone) or Chrome (Android),
allow camera access when asked, and try it.

- **Practice mode** (the tab that opens by default) is the original
  single-phone screen: pick a mode, show a sign, watch it get recognized.
- **Conversation mode** (the other tab) needs Firebase set up (Step 4).
  On one phone, tap **Start a Conversation** — it shows a 4-digit code
  and a QR code. On the other phone, either scan that QR code, or tap
  **Join a Conversation** and type the code in by hand. Once both
  phones show the same room, each phone's camera (and microphone, if
  allowed) turns on automatically and a **live video call** starts
  between the two phones — you'll see "Them" at the top and "You"
  further down. Either person can sign (their camera is already
  running — just build up a message the same way Practice mode works,
  then tap **Send**) or type a message and tap **Send** — it appears
  as a chat bubble on the other phone in a couple of seconds, alongside
  the live video.
- **Install it like an app:**
  - Android/Chrome: you should see an "Install app" prompt, or use the
    ⋮ menu → **Add to Home screen**.
  - iPhone/Safari: tap the **Share** icon → **Add to Home Screen**.
  Either way you get a home-screen icon that opens full-screen, without
  browser address bars.
- If the camera view appears but nothing gets recognized, or
  Conversation mode says it can't connect, open the page's developer
  console (on Android, connect the phone to a computer and use
  `chrome://inspect`; on iPhone, enable Safari's **Web Inspector**
  under Settings → Safari → Advanced, then inspect from a Mac if you
  have access to one, or check for a red status pill at the top of the
  app first — it will say things like "no trained model yet", "could
  not load MediaPipe", or point at `firebase-config.js` before you dig
  into the console).

## Competition "wow factor" features

Five extra features on top of the core recognizer, built for the Ministry
of Education exhibition demo. All five need nothing beyond what's already
in this folder -- no new accounts, no new services, no extra cost.

### 1. Spoken voice output (English + Arabic)

The **🔊 Voice** button at the top of every screen turns spoken audio on
or off. When on, every time a sign is recognized and typed (Practice,
Conversation, or Quiz), the app speaks the English word out loud -- and,
for any class that has an Arabic label too (Arabic Sign Language,
Essential Needs, UAE Etiquette), the Arabic word right after it. In
Conversation mode, an incoming message from the other phone is also read
aloud automatically, like a live interpreter.

This uses the phone's own built-in text-to-speech (the same engine
Siri/Google Assistant use) -- no internet needed once the page is
loaded, no API key, no cost. **Honest limitation:** Arabic voice quality
and availability varies by phone. Most modern Android and iPhone devices
have a built-in Arabic voice, but test this on the *exact* phone you'll
demo with, a few days before the event, in case that one device needs
its language pack installed (Settings → Language & Region, on either
platform).

### 2. Live auto-captions during the video call

In Conversation mode, the **Auto-caption** toggle next to the "Draft" box
(on by default) makes every recognized sign stream to the other phone
**immediately** -- as a live caption under the video, like TV subtitles
-- instead of waiting for you to build a full message and tap Send. Stop
signing for about 2.5 seconds and whatever you signed automatically
becomes a real chat message. You can still tap **Send** manually at any
time, or turn Auto-caption off to go back to the original build-then-send
behavior.

### 3. The QR audience-participation demo

Two different QR codes now appear once a Conversation-mode room is open:

- **QR** (the original one) -- lets a *second phone* join the actual
  conversation with its own camera, for a real two-way demo.
- **Audience QR** (new) -- opens `audience.html`: a read-only, camera-free
  page that shows the same live captions in huge, projector-friendly
  text. It needs no login, no app, no camera permission -- just a phone
  browser.

**Suggested live-demo flow for the exhibition:**
1. Before your slot, start a Conversation-mode room on the presenter's
   phone and tap **Audience QR**.
2. Either project that phone's screen (or `audience.html` opened on a
   laptop connected to the venue screen) behind you, **or** hold up the
   QR code and invite VIPs/judges to scan it on their own phones.
3. As you sign, the audience sees your words appear live, in huge text,
   on their own screens or the big screen -- a concrete, visual "this is
   really working right now" moment that's much stronger than just
   describing the project verbally.
4. Optionally, invite one VIP to try **Quiz mode** (see below) on a
   second phone afterwards, for a hands-on moment.

### 3b. Front/back camera switch

The **🤳 Front / 📷 Back** button at the top switches between the phone's
selfie camera and its rear camera, on all three screens. Use the rear
camera when you're filming *someone else* signing — a student on stage, or
a visitor trying it — rather than yourself.

The view is mirrored on the front camera (so raising your right hand raises
the hand on the right of the screen, as people expect) and un-mirrored on
the back camera (so the person you're filming isn't flipped). The
hand-skeleton overlay flips with it. Recognition is unaffected either way:
MediaPipe reads the real camera frame, not the mirrored picture.

In Conversation mode the switch happens *without dropping the video call* —
only the video being sent is swapped; the microphone keeps running.

### 4. Haptic + sound feedback

Every time a sign is successfully recognized and typed, the phone gives a
short vibration and a soft beep (Practice, Conversation, and Quiz modes).
This is a small thing, but it makes the recognizer feel instant and
responsive when someone is watching over your shoulder rather than
staring at the screen for a status message.

### 5. Quiz mode (a 60-second game)

A third tab, **Quiz**, next to Practice and Conversation. Pick a mode,
tap **Start Quiz**, and sign whatever word/letter appears on screen as
fast as you can -- each correct sign scores a point (with a green flash
+ vibration + beep) and immediately shows the next one, for 60 seconds.
The best score reached on that phone is remembered (shown as "Best") so
visitors and VIPs can compete against each other -- a natural way to let
someone try the recognizer hands-on instead of only watching you use it.

## Updating after you retrain, change modes.py, or edit firebase-config.js

1. Re-run `convert_models_to_js.py` (Step 2) if you retrained a model.
2. If you changed `modes.py`'s display text, mirror the change in
   `webapp/modes.js` by hand (it's a straightforward copy — see the
   comment at the top of `modes.js`).
3. Go back to your GitHub repo, **Add file → Upload files**, and
   re-upload the changed files (GitHub will ask to confirm overwriting
   them). Pages redeploys automatically within a minute or two.

## Honest limitations to know about

- This app was built and code-reviewed without a live internet
  connection to test the camera + MediaPipe integration end-to-end (the
  environment it was built in blocks the CDN hosts MediaPipe needs).
  The architecture, API calls, and URLs are taken directly from Google's
  official MediaPipe documentation and sample code, but **please do
  Step 3 (local test) yourself** before your demo, with enough lead time
  to troubleshoot if something needs adjusting.
- `app.js` loads MediaPipe from `@mediapipe/tasks-vision@latest` on
  jsDelivr. "`@latest`" means it always grabs the newest version, which
  is convenient but could theoretically change behavior later. If you
  want it to stop changing once it's working, you can pin it: open
  `app.js`, find the two lines with `@latest`, and replace `@latest`
  with the version number shown at
  [npmjs.com/package/@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision)
  at the time you test it.
- The first time the app loads on a phone (or after clearing browser
  data), it needs an internet connection to download the ~10-20MB
  MediaPipe hand-tracking model. After that first load, the service
  worker keeps the app shell (and your trained models) cached, but the
  MediaPipe model itself relies on the browser's normal cache — keep
  the phone online for your demo to be safe.
- Conversation mode's screens and logic were tested with a stand-in
  fake database (since, like the MediaPipe CDN, the real Firebase
  service could not be reached from the environment this was built in)
  — the actual message-sending code follows Firebase's documented API
  exactly, but **please test it for real** between two phones (or two
  browser tabs on your computer) well before the competition, the same
  way Step 3 asks you to test Practice mode.
- The **live video call** uses free public STUN servers (the standard
  way two devices on the internet find a path to each other for a
  direct call), but not a paid TURN relay server. This connects fine on
  most home wifi and mobile data. On a strict school/office network —
  the same kind that can block the MediaPipe/Firebase CDNs elsewhere in
  this project — the video call specifically may fail to connect even
  though everything else (Practice mode, sign-to-text chat messages)
  keeps working, since chat messages don't need this same kind of
  connection. If the video call doesn't connect on your school's wifi,
  try your phone's own mobile data or a personal hotspot instead — the
  underlying WebRTC connection code was tested and confirmed working
  end-to-end (two real browser connections reaching each other and
  exchanging live video/audio) in the environment this was built in,
  so a failure on a specific network is a network restriction, not a
  bug to debug in the code.
- The video call asks for **camera AND microphone** permission (camera
  alone is used if microphone access is denied) — allow both when your
  browser asks, for both phones.
- The Firebase Realtime Database rules in Step 4 are intentionally
  simple (open read/write to anyone who has a room code) -- fine for a
  short-lived school project where the "secret" is a random 4-digit
  code nobody else will guess, but not the kind of security you'd want
  for a real product with real user data.
- Firebase's free tier is far more than enough for a classroom demo (it's
  sized for real apps with many users), so there's no cost or usage limit
  to worry about here.
- **Voice output** depends on the phone's own installed text-to-speech
  voices -- test it (both the English and Arabic parts) on your actual
  demo phone ahead of time, not just on your computer's browser, since
  voice availability differs by device.
- **Quiz mode's "Best" score** is stored in the phone's browser storage,
  not Firebase -- it's per-phone/per-browser, resets if someone clears
  their browser data, and isn't shared between different visitors' phones.
  That's fine for a fun, casual leaderboard-of-one; it's not a real
  competition leaderboard across many phones.
- **Auto-caption / live captions** and the **Audience QR page** both
  depend on the same Firebase project as regular Conversation-mode
  messages, so if Conversation mode works for you, these will too --
  and if Conversation mode can't connect, neither will these.

## If you're short on time before the competition

Given the timeline, this priority order gets you to a working demo
fastest:

1. Get **Practice mode, ASL only** working end-to-end: train → convert
   → deploy → test on your phone. This proves every part of the core
   pipeline (camera, MediaPipe, the converted model, GitHub Pages)
   works together.
2. Get **Conversation mode** working between two phones (Step 4, then
   Step 6) — this only needs the ASL model you already trained, no
   extra training required.
3. Only then add the other three sign-language modes — each one is
   just "collect → dataset → train → convert → re-upload," repeated.
4. The five "wow factor" features above (Voice, Auto-caption, the QR
   audience demo, haptic/sound feedback, Quiz mode) all come for free
   once you upload the new `webapp` files — there's nothing extra to
   train or configure for them. But recognition accuracy matters more
   than any of these: a flashy feature sitting on top of an ASL model
   that keeps misreading letters will read as *less* impressive in front
   of VIPs, not more. If you're tight on time, prioritize getting ASL
   recognition solid (mostly your own recorded photos, not a huge
   external dataset — see the "Optional: boosting ASL letter accuracy"
   section in `../README_UAE_FEATURES.md`) before rehearsing the demo
   flow around these extra features.
