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
uploaded anywhere.

## What's in this folder

```
webapp/
  index.html            the app's single screen
  styles.css            styling
  app.js                camera + MediaPipe + recognition + UI logic
  modes.js              JS copy of ../modes.py's class/label data
  manifest.json          makes the app installable ("Add to Home Screen")
  service-worker.js      caches the app shell so it still opens offline
  icons/                 app icons
  models/                 EMPTY until you run convert_models_to_js.py --
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

## Step 4 — Put it online (GitHub Pages, free, no Mac needed)

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
   contents** (`index.html`, `styles.css`, `app.js`, `modes.js`,
   `manifest.json`, `service-worker.js`, the `icons` folder, and the
   `models` folder) into the upload area — the files need to sit at the
   **root** of the repo, not inside an extra `webapp` folder.
5. Scroll down and click **Commit changes**.
6. Go to the repo's **Settings** tab → **Pages** (left sidebar).
7. Under "Build and deployment", set **Source** to **Deploy from a
   branch**, branch **main**, folder **/ (root)**, then **Save**.
8. Wait about a minute, then refresh the Pages settings page — it will
   show your live URL, something like
   `https://your-username.github.io/uae-sign-language/`.

## Step 5 — Open it on your phone

Open that `https://...` link in Safari (iPhone) or Chrome (Android),
allow camera access when asked, and try it.

- **Install it like an app:**
  - Android/Chrome: you should see an "Install app" prompt, or use the
    ⋮ menu → **Add to Home screen**.
  - iPhone/Safari: tap the **Share** icon → **Add to Home Screen**.
  Either way you get a home-screen icon that opens full-screen, without
  browser address bars.
- If the camera view appears but nothing gets recognized, open the
  page's developer console (on Android, connect the phone to a computer
  and use `chrome://inspect`; on iPhone, enable Safari's **Web
  Inspector** under Settings → Safari → Advanced, then inspect from a
  Mac if you have access to one, or check for a red status pill at the
  top of the app first — it will say things like "no trained model yet"
  or "could not load MediaPipe" before you dig into the console).

## Updating after you retrain or change modes.py

1. Re-run `convert_models_to_js.py` (Step 2).
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

## If you're short on time before the competition

Given the timeline, this priority order gets you to a working demo
fastest:

1. Get **ASL only** working end-to-end: train → convert → deploy →
   test on your phone. This proves every part of the pipeline (camera,
   MediaPipe, the converted model, GitHub Pages) works together.
2. Only then add the other three modes — each one is just "collect →
   dataset → train → convert → re-upload," repeated.
