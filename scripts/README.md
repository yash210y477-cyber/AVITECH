# Proctoring model setup

The exam uses COCO-SSD Lite MobileNetV2 for **mobile-phone** and **book/study-material** detection.

The model is intentionally served from the AVITECH application itself during an exam. There is no runtime fallback to Google's model-hosting endpoint.

## One-time setup

From the project root:

```bash
python scripts/download_proctor_models.py
```

The script downloads `model.json` plus all five weight shards into:

```text
static/models/coco-ssd/
```

The installer verifies the expected byte size of every file and fails if a download is incomplete.

## Important

Run this before deploying the project. If the local model is missing, proctoring will refuse to start the test rather than silently running without phone/study-material detection.
