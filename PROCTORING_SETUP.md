# AVITECH Proctoring Setup

## Required before deployment

Install the self-hosted COCO-SSD model used for mobile-phone and book/study-material detection:

```bash
python scripts/download_proctor_models.py
```

The installer places these six files in `static/models/coco-ssd/` and verifies their sizes:

- `model.json`
- `group1-shard1of5`
- `group1-shard2of5`
- `group1-shard3of5`
- `group1-shard4of5`
- `group1-shard5of5`

The exam **will not start** if these local model files are missing or corrupted. There is no runtime fallback to a remote model host.

The browser still needs the TensorFlow.js/COCO-SSD JavaScript libraries used by the existing pages; the large model weights themselves are served by this application locally.
