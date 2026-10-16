"""Public distribution and local request-boundary regressions."""
import unittest
from unittest.mock import patch

import app


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_rejects_dns_rebinding_remote_peers_and_cross_site_calls(self):
        self.assertEqual(self.client.get('/', headers={'Host': 'attacker.example'}).status_code, 400)
        self.assertEqual(self.client.get('/', environ_overrides={'REMOTE_ADDR': '192.0.2.1'}).status_code, 403)
        for headers in ({'Origin': 'https://attacker.example'}, {'Sec-Fetch-Site': 'cross-site'},
                        {'Origin': 'null'}, {'Referer': 'https://attacker.example/'}):
            self.assertEqual(self.client.post('/api/youtube', json={}, headers=headers).status_code, 403)
        self.assertEqual(self.client.get('/', headers={'Origin': 'http://localhost'}).status_code, 200)

    def test_headers_and_missing_optional_key(self):
        response = self.client.get('/')
        self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        self.assertNotIn('unsafe-eval', response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(response.headers['Permissions-Policy'], 'camera=(), microphone=(self), geolocation=()')
        with patch.object(app, 'GIPHY_API_KEY', ''):
            response = self.client.get('/api/gifs')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_dependency_errors_do_not_expose_credentials(self):
        from requests import RequestException
        with patch.object(app, 'GIPHY_API_KEY', 'test-placeholder'), patch.object(
                app.requests, 'get', side_effect=RequestException('https://example.test/?api_key=private-value')):
            response = self.client.get('/api/gifs')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('private-value', response.get_data(as_text=True))
        self.assertNotIn('example.test', response.get_data(as_text=True))

    def test_job_status_never_includes_local_paths(self):
        with patch.dict(app.YT_JOBS, {'test': {'state': 'done', 'file_path': '/private/song.mp3'}}):
            response = self.client.get('/api/youtube/status/test')
        self.assertEqual(response.json, {'state': 'done'})

    def test_invalid_download_payload_is_rejected(self):
        for payload in ([], ['url'], 'text', {'url': 123}):
            self.assertEqual(self.client.post('/api/youtube', json=payload).status_code, 400)
