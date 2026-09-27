import unittest
from unittest.mock import patch, MagicMock
import app

class YouTubeEndpointTests(unittest.TestCase):
    def setUp(self):
        app.app.config["TESTING"] = True
        self.client = app.app.test_client()

    def test_search_missing_query(self):
        res = self.client.get("/api/youtube/search")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["items"], [])
        self.assertEqual(data["status"], "success")

    def test_search_keyword_mocked(self):
        mock_info = {
            "entries": [
                {
                    "id": "abc12345",
                    "title": "Lofi Chill Beats (Official Audio)",
                    "duration": 185,
                    "uploader": "Lofi Girl",
                    "thumbnail": "https://example.com/thumb.jpg",
                }
            ]
        }
        with patch("yt_dlp.YoutubeDL") as MockYdl:
            mock_inst = MagicMock()
            mock_inst.__enter__.return_value = mock_inst
            mock_inst.extract_info.return_value = mock_info
            MockYdl.return_value = mock_inst

            res = self.client.get("/api/youtube/search?q=lofi")
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data["status"], "success")
            self.assertFalse(data["is_direct"])
            self.assertEqual(len(data["items"]), 1)
            item = data["items"][0]
            self.assertEqual(item["id"], "abc12345")
            self.assertEqual(item["title"], "Lofi Chill Beats")
            self.assertEqual(item["duration_formatted"], "3:05")
            self.assertEqual(item["uploader"], "Lofi Girl")

    def test_search_direct_url_mocked(self):
        mock_info = {
            "id": "xyz987",
            "title": "Anime Rain Visualizer [1080p]",
            "duration": 3600,
            "uploader": "Rain Vibes",
            "webpage_url": "https://www.youtube.com/watch?v=xyz987",
        }
        with patch("yt_dlp.YoutubeDL") as MockYdl:
            mock_inst = MagicMock()
            mock_inst.__enter__.return_value = mock_inst
            mock_inst.extract_info.return_value = mock_info
            MockYdl.return_value = mock_inst

            res = self.client.get("/api/youtube/search?q=https://www.youtube.com/watch?v=xyz987")
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data["status"], "success")
            self.assertTrue(data["is_direct"])
            self.assertEqual(len(data["items"]), 1)
            item = data["items"][0]
            self.assertEqual(item["id"], "xyz987")
            self.assertEqual(item["title"], "Anime Rain Visualizer")
            self.assertEqual(item["duration_formatted"], "1:00:00")

    def test_download_validation(self):
        res = self.client.post("/api/youtube", json={})
        self.assertEqual(res.status_code, 400)

        res = self.client.post("/api/youtube", json={"url": "https://evil.com/video"})
        self.assertEqual(res.status_code, 400)

    def test_download_queueing(self):
        with patch("threading.Thread"), patch.object(app, "YT_SLOT"):
            res = self.client.post("/api/youtube", json={
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "type": "video"
            })
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data["status"], "queued")
            job_id = data["job_id"]

            status_res = self.client.get(f"/api/youtube/status/{job_id}")
            self.assertEqual(status_res.status_code, 200)
            status_data = status_res.get_json()
            self.assertEqual(status_data["type"], "video")
            self.assertEqual(status_data["state"], "running")

    def test_safe_stream_swallows_errno_22(self):
        class BrokenTarget:
            def write(self, s):
                raise OSError(22, "Invalid argument")
            def flush(self):
                raise OSError(22, "Invalid argument")

        stream = app._SafeStream(BrokenTarget())
        # Should not raise exception
        stream.write("test log")
        stream.flush()

        class BrokenBuf:
            def write(self, b):
                raise OSError(22, "Invalid argument")
            def flush(self):
                raise OSError(22, "Invalid argument")

        class TargetWithBuf:
            buffer = BrokenBuf()

        stream2 = app._SafeStream(TargetWithBuf())
        stream2.buffer.write(b"raw bytes")
        stream2.buffer.flush()

    def test_search_passes_quiet_logger(self):
        with patch("yt_dlp.YoutubeDL") as MockYdl:
            mock_inst = MagicMock()
            mock_inst.__enter__.return_value = mock_inst
            mock_inst.extract_info.return_value = {"entries": []}
            MockYdl.return_value = mock_inst

            res = self.client.get("/api/youtube/search?q=test")
            self.assertEqual(res.status_code, 200)

            # Ensure YoutubeDL was called with a logger option
            opts = MockYdl.call_args[0][0]
            self.assertIn("logger", opts)
            self.assertIsInstance(opts["logger"], app._YtdlpQuietLogger)

    def test_search_with_broken_stderr_buffer(self):
        class BrokenBuffer:
            def write(self, b):
                raise OSError(22, "Invalid argument")
            def flush(self):
                raise OSError(22, "Invalid argument")

        class BrokenStderr:
            buffer = BrokenBuffer()
            def write(self, s):
                raise OSError(22, "Invalid argument")
            def flush(self):
                raise OSError(22, "Invalid argument")

        import sys
        old_stderr = sys.stderr
        try:
            sys.stderr = app._SafeStream(BrokenStderr())
            with patch("yt_dlp.YoutubeDL") as MockYdl:
                mock_inst = MagicMock()
                mock_inst.__enter__.return_value = mock_inst
                mock_inst.extract_info.return_value = {"entries": []}
                MockYdl.return_value = mock_inst

                res = self.client.get("/api/youtube/search?q=lofi")
                self.assertEqual(res.status_code, 200)
                data = res.get_json()
                self.assertEqual(data["status"], "success")
        finally:
            sys.stderr = old_stderr

if __name__ == "__main__":
    unittest.main()
