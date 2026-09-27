import io
import unittest
from PIL import Image
import app

class TestOverlayAPI(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_upload_and_get_overlay(self):
        # Create a test transparent PNG image in memory
        img = Image.new("RGBA", (100, 100), (255, 0, 0, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        # Upload
        res = self.client.post("/api/overlay", data={"file": (buf, "test_logo.png")})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("asset", data)
        self.assertEqual(data["name"], "test_logo.png")
        self.assertEqual(data["width"], 100)
        self.assertEqual(data["height"], 100)

        asset_id = data["asset"]
        # Fetch the uploaded overlay
        get_res = self.client.get(f"/api/overlay/{asset_id}")
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.mimetype, "image/png")
        get_res.close()

    def test_upload_empty_file_fails(self):
        res = self.client.post("/api/overlay", data={})
        self.assertEqual(res.status_code, 400)

    def test_get_nonexistent_overlay_404(self):
        fake_id = "0" * 64
        res = self.client.get(f"/api/overlay/{fake_id}")
        self.assertEqual(res.status_code, 404)

if __name__ == "__main__":
    unittest.main()
