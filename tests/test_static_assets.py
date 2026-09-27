"""Validate data assets before rendering; Unicode separators are valid JSON keys."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticAssetTests(unittest.TestCase):
    def test_font_metric_unicode_keys_are_preserved(self):
        metrics = json.loads((ROOT / 'static/lyric-fonts.json').read_text(encoding='utf-8'))
        for family, font in metrics.items():
            for character in ('\u0085', '\u2028', '\u2029'):
                with self.subTest(family=family, character=ord(character)):
                    self.assertIn(character, font['widths'])
                    self.assertGreaterEqual(font['widths'][character], 0)

    def test_vendored_library_checksums(self):
        folder = ROOT / 'static/vendor/wavesurfer-7.12.12'
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
        for name, item in manifest.items():
            with self.subTest(name=name):
                self.assertEqual(hashlib.sha256((folder / name).read_bytes()).hexdigest(), item['sha256'])
