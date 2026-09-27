import json
import unittest
from unittest.mock import patch

import lyric_search


class SearchTests(unittest.TestCase):
    def setUp(self):
        lyric_search._CACHE.clear()

    def test_title_only_query_ranks_artist_variants_without_trusting_cover(self):
        records = [dict(id=1, trackName="Şarkı", artistName="Unrelated Cover Band", duration=200,
                        syncedLyrics="[00:01]cover"),
                   dict(id=2, trackName="Sarki", artistName="Özgün, Guest", duration=201,
                        syncedLyrics="[00:01]original"),
                   dict(id=3, trackName="Sarki live", artistName="Özgün", duration=350,
                        syncedLyrics="[00:01]live")]
        class Response:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def iter_content(self, *_): yield json.dumps(records).encode()
        with patch("lyric_search.requests.get", return_value=Response()) as get:
            result = lyric_search.search("Şarkı [abcdef12345]", "Ozgun - Topic", 200)
            self.assertEqual(get.call_args.kwargs["params"], {"track_name": "Şarkı"})
            self.assertEqual(result[0]["id"], 2)
            self.assertTrue(result[0]["closeMatch"])
            self.assertGreaterEqual(result[0]["artistSimilarity"], .85)
            self.assertFalse(next(r for r in result if r["id"] == 1)["closeMatch"])
            self.assertFalse(next(r for r in result if r["id"] == 3)["closeMatch"])
            lyric_search.search("Şarkı [abcdef12345]", "Ozgun - Topic", 200)
            self.assertEqual(get.call_count, 1)
            unknown_duration = lyric_search.search("Şarkı", "Ozgun", 0)
            self.assertFalse(any(r["closeMatch"] for r in unknown_duration))
            no_artist = lyric_search.search("Şarkı", "", 200)
            self.assertIsNone(no_artist[0]["artistSimilarity"])

    def test_artist_unicode_credit_order_and_no_substring_match(self):
        compare = lyric_search.artist_similarity
        self.assertEqual(compare("İç Işık", "Ic Isik"), 1)
        self.assertEqual(compare("Artist B & Artist A", "Artist A & Artist B"), 1)
        self.assertGreaterEqual(compare("Madrigal", "Madrigal feat. Guest"), .85)
        self.assertLess(compare("AB", "ABBA"), .85)
        self.assertEqual(compare("Artist", ""), 0)


if __name__ == "__main__":
    unittest.main()
