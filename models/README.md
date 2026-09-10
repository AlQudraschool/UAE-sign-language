# This folder is intentionally (almost) empty

`model_asl.js`, `model_arsl.js`, `model_needs.js`, and `model_etiquette.js`
belong here, but they are **generated files** — created by running
`convert_models_to_js.py` (in the project root) after you've trained the
matching model with the Python pipeline (`train_classifier.py`).

Until a mode's file exists here, that mode will show "no trained model
yet" in the app and won't be able to recognize anything — the camera and
hand-tracking will still work, since those don't depend on this folder.

See `README_WEBAPP.md` for the full steps.
