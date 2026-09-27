import io
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import app
import engine
import media_assets as media


def dns(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443))]


class RemoteTests(unittest.TestCase):
    def test_private_targets_and_schemes_rejected(self):
        for url in ('file:///tmp/x', 'http://user:pass@example.com/x', 'http://example.com:8000/x'):
            with self.assertRaises(ValueError):
                media.public_target(url)
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1'):
            with patch.object(media.socket, 'getaddrinfo', return_value=dns(address)):
                with self.assertRaises(ValueError):
                    media.public_target('https://example.com/video')

    def test_pinned_https_and_redirect_revalidation(self):
        class Response:
            status = 302
            headers = {'Location': 'http://127.0.0.1/private'}
            def close(self): pass
        class Pool:
            def urlopen(self, *args, **kwargs): return Response()
            def close(self): pass
        with patch.object(media.socket, 'getaddrinfo', side_effect=[dns('8.8.8.8'), dns('127.0.0.1')]), \
             patch.object(media.urllib3, 'HTTPSConnectionPool', return_value=Pool()) as pool:
            with self.assertRaises(ValueError):
                media.download_public('https://example.com/video', 'unused')
            self.assertEqual(pool.call_count, 1)
            self.assertEqual(pool.call_args.args[0], '8.8.8.8')
            self.assertEqual(pool.call_args.kwargs['server_hostname'], 'example.com')
            self.assertEqual(pool.call_args.kwargs['assert_hostname'], 'example.com')

    def test_paths_cannot_escape_asset_directory(self):
        for value in ('../outputs/a', 'a'*63, 'A'*64, '', None):
            with self.assertRaises(ValueError):
                media.asset_path(value)


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cache_patch = patch.object(media, 'ASSET_DIR', self.root/'cache')
        self.cache_patch.start()
        self.ffmpeg = engine._ffmpeg_bin()

    def tearDown(self):
        self.cache_patch.stop()
        self.temp.cleanup()

    def fixture(self, suffix='.mp4', size='320x180', rate=24):
        path = self.root/('fixture'+suffix)
        command = [self.ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size={size}:rate={rate}:duration=1']
        if suffix == '.webm': command += ['-c:v', 'libvpx-vp9', '-deadline', 'realtime']
        elif suffix == '.mp4': command += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
        subprocess.run(command + [str(path)], check=True, capture_output=True)
        return path

    def test_mp4_portrait_gif_and_webm_proxy(self):
        for suffix, size, rate in (('.mp4','1920x1080',60), ('.gif','120x200',10), ('.webm','160x90',24)):
            source = self.fixture(suffix, size, rate)
            info = media.prepare_asset(source, source.name, self.ffmpeg)
            self.assertLessEqual(info['preview_width'], 1280)
            self.assertLessEqual(info['preview_height'], 720)
            self.assertAlmostEqual(info['duration'], info['preview_duration'], delta=.11)
            preview = media.probe(media.asset_path(info['asset'])/'preview.mp4', self.ffmpeg)
            self.assertEqual(preview['codec'], 'h264')
            self.assertEqual(preview['width']%2, 0)
            self.assertEqual(preview['height']%2, 0)
            self.assertTrue(Path(media.source_path(info['asset'])).is_file())
            with patch.object(media, 'probe', side_effect=AssertionError('cache miss')):
                again = media.prepare_asset(source, 'renamed'+suffix, self.ffmpeg)
                self.assertEqual(again['asset'], info['asset'])

    def test_corrupt_and_playlist_files_rejected(self):
        for content in (b'not a video', b'#EXTM3U\nhttp://127.0.0.1/private\n'):
            source=self.root/'bad';source.write_bytes(content)
            with self.assertRaises(ValueError):
                media.prepare_asset(source,'bad',self.ffmpeg)
        self.assertFalse(media.ASSET_DIR.exists())

    def test_import_endpoint_and_range_stream(self):
        source=self.fixture()
        client=app.app.test_client()
        with source.open('rb') as handle:
            response=client.post('/api/media',data={'file':(io.BytesIO(handle.read()),'clip.mp4')})
        self.assertEqual(response.status_code,202)
        job_id=response.json['job_id']
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            job=client.get('/api/media/jobs/'+job_id).json
            if job['state']!='running':break
            time.sleep(.03)
        self.assertEqual(job['state'],'done',job)
        asset=job['media']['asset']
        self.assertEqual(client.get('/api/media/'+asset).status_code,200)
        response=client.get('/api/media/'+asset+'/preview',headers={'Range':'bytes=0-31'})
        self.assertEqual(response.status_code,206)
        self.assertEqual(len(response.data),32)
        response.close()
        self.assertEqual(client.get('/api/media/'+'f'*64).status_code,404)

    def test_render_requires_prepared_asset(self):
        from project import TRACK_IDS, validate_project
        p=validate_project({'version':1,'tracks':{kind:{} for kind in TRACK_IDS}})
        p['tracks']['main']['source']={'name':'main.wav','size':1,'lastModified':0,'duration':1}
        p['background']['url']='http://127.0.0.1/private'
        with patch.object(app.threading,'Thread') as thread:
            response=app.app.test_client().post('/render',data={'project':json.dumps(p),'main_file':(io.BytesIO(b'x'),'main.wav')})
            self.assertEqual(response.status_code,400)
            thread.assert_not_called()

    def test_busy_preparation_returns_429(self):
        app.MEDIA_SLOT.acquire()
        try:
            response=app.app.test_client().post('/api/media',data={'url':'https://example.com/video'})
            self.assertEqual(response.status_code,429)
        finally:
            app.MEDIA_SLOT.release()

    def test_preview_quality_profiles_cache_and_bounds(self):
        source=self.fixture(size='1280x720',rate=60)
        info=media.prepare_asset(source,source.name,self.ffmpeg)
        asset=info['asset'];original=Path(media.source_path(asset)).read_bytes()
        for quality,width,height,rate in [('low',640,360,30),('medium',960,540,60),('high',1280,720,60)]:
            proxy=media.prepare_preview(asset,quality,self.ffmpeg)
            self.assertEqual((proxy['width'],proxy['height']),(width,height))
            self.assertAlmostEqual(proxy['fps'],rate,delta=.01)
            self.assertAlmostEqual(proxy['duration'],info['duration'],delta=.04)
            response=app.app.test_client().get(proxy['url'],headers={'Range':'bytes=0-31'})
            self.assertEqual(response.status_code,206);self.assertEqual(len(response.data),32);response.close()
            with patch.object(media.subprocess,'run',side_effect=AssertionError('cache miss')):
                self.assertEqual(media.prepare_preview(asset,quality,self.ffmpeg),proxy)
        self.assertEqual(Path(media.source_path(asset)).read_bytes(),original)
        self.assertEqual(media.asset_info(asset),info)
        client=app.app.test_client()
        for invalid in ['../x','ultra',[],None]:
            self.assertEqual(client.post('/api/media/'+asset+'/preview-quality',json={'quality':invalid}).status_code,400)
        self.assertEqual(client.post('/api/media/'+asset+'/preview-quality',json=[]).status_code,400)

    def test_quality_job_and_busy_slot(self):
        source=self.fixture();info=media.prepare_asset(source,source.name,self.ffmpeg)
        client=app.app.test_client();url='/api/media/'+info['asset']+'/preview-quality'
        app.MEDIA_SLOT.acquire()
        try:
            self.assertEqual(client.post(url,json={'quality':'low'}).status_code,429)
            self.assertEqual(client.post(url,json={'quality':'high'}).status_code,200)
        finally:app.MEDIA_SLOT.release()
        response=client.post(url,json={'quality':'low'})
        self.assertEqual(response.status_code,202)
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            job=client.get('/api/media/jobs/'+response.json['job_id']).json
            if job['state']!='running':break
            time.sleep(.03)
        self.assertEqual(job['state'],'done',job);self.assertEqual(job['preview']['quality'],'low')


if __name__=='__main__':
    unittest.main()
