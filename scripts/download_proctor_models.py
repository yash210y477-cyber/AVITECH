#!/usr/bin/env python3
"""Download the COCO-SSD Lite MobileNetV2 TFJS model for offline proctoring.

Run once from the project root:
    python scripts/download_proctor_models.py

The resulting files are served locally from /static/models/coco-ssd and the
browser no longer needs Google's model-hosting endpoint during an exam.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'static' / 'models' / 'coco-ssd'
BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/'
FILES = [
    'model.json',
    'group1-shard1of5',
    'group1-shard2of5',
    'group1-shard3of5',
    'group1-shard4of5',
    'group1-shard5of5',
]

# Known byte sizes for the official TFJS model. This catches incomplete downloads.
EXPECTED_SIZES = {
    'model.json': 527315,
    'group1-shard1of5': 4194304,
    'group1-shard2of5': 4194304,
    'group1-shard3of5': 4194304,
    'group1-shard4of5': 4194304,
    'group1-shard5of5': 1257312,
}


def download(name: str) -> None:
    target = OUT / name
    url = BASE + name
    print(f'Downloading {name} ...')
    req = Request(url, headers={'User-Agent': 'AVITECH-proctor-model-installer/1.0'})
    with urlopen(req, timeout=120) as src, target.open('wb') as dst:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            dst.write(chunk)
    actual = target.stat().st_size
    expected = EXPECTED_SIZES[name]
    if actual != expected:
        target.unlink(missing_ok=True)
        raise RuntimeError(f'{name}: expected {expected} bytes, got {actual}')


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        for name in FILES:
            target = OUT / name
            if target.exists() and target.stat().st_size == EXPECTED_SIZES[name]:
                print(f'OK {name} (already present)')
                continue
            download(name)
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        print('The test will remain blocked until all local model files are installed.', file=sys.stderr)
        return 1

    print(f'\nCOCO-SSD local model ready: {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
