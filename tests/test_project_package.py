import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

import engine
import media_assets
from project import TRACK_IDS, validate_project
from project_package import build_package, unpack_package


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cozy_package_test_')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.song = self.root / 'song.wav'
        with wave.open(str(self.song), 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
            audio.writeframes(b'\0\0' * 8000)
        self.project = validate_project(dict(version=1, tracks={k: {} for k in TRACK_IDS}))
        self.project['tracks']['main'].update(start=.1,end=.9,source=dict(
            name='Şarkı.wav',size=self.song.stat().st_size,lastModified=123,duration=1))
        self.project['lyrics']['lines'] = [dict(id='one',text='Yağmur',start=.2,end=.7,confidence=None,review=False)]

    def archive(self):
        result=io.BytesIO();build_package(result,self.project,{'media/main':self.song});result.seek(0);return result

    def rewrite(self, data, edit):
        with zipfile.ZipFile(data) as source:
            files={name:source.read(name) for name in source.namelist()}
        edit(files)
        result=io.BytesIO()
        with zipfile.ZipFile(result,'w') as output:
            for name,content in files.items(): output.writestr(name,content)
        result.seek(0);return result

    def test_round_trip_in_different_directory(self):
        destination=self.root/'other';destination.mkdir()
        project,files=unpack_package(self.archive(),destination)
        self.assertEqual(project,validate_project(self.project))
        self.assertEqual(Path(files['media/main']).read_bytes(),self.song.read_bytes())
        self.assertEqual(project['tracks']['main']['source']['lastModified'],123)

    def test_corruption_missing_and_paths_are_rejected(self):
        for edit in [lambda f:f.update({'media/main':b'X'*len(f['media/main'])}),
                     lambda f:f.pop('media/main'), lambda f:f.update({'../outside':b'x'}),
                     lambda f:f.update({'manifest.json':b'{}'})]:
            with self.subTest(edit=edit):
                with self.assertRaises(ValueError):unpack_package(self.rewrite(self.archive(),edit),self.root)
        self.assertFalse((self.root.parent/'outside').exists())

    def test_duplicate_symlink_oversize_and_future_version(self):
        data=self.archive()
        with zipfile.ZipFile(data,'a') as archive:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore');archive.writestr('project.json',b'{}')
        data.seek(0)
        with self.assertRaises(ValueError):unpack_package(data,self.root)
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as archive:
            info=zipfile.ZipInfo('project.json');info.external_attr=0o120777<<16
            archive.writestr(info,b'/outside');archive.writestr('manifest.json',b'{}')
        data.seek(0)
        with self.assertRaises(ValueError):unpack_package(data,self.root)
        with patch('project_package.MAX_PACKAGE_BYTES',100):
            with self.assertRaises(ValueError):unpack_package(self.archive_unlimited(),self.root)
        def future(files):
            manifest=json.loads(files['manifest.json']);manifest['version']=99
            files['manifest.json']=json.dumps(manifest).encode()
        with self.assertRaises(ValueError):unpack_package(self.rewrite(self.archive(),future),self.root)

    def archive_unlimited(self):
        with patch('project_package.MAX_PACKAGE_BYTES',500*1024*1024):return self.archive()

    def test_export_requires_all_media_and_actual_size(self):
        with self.assertRaises(ValueError):build_package(io.BytesIO(),self.project,{})
        self.project['tracks']['main']['source']['size']+=1
        with self.assertRaises(ValueError):self.archive()

    def test_http_package_moves_video_to_fresh_cache_and_releases_audio(self):
        from app import app
        video=self.root/'video.mp4'
        subprocess.run([engine._ffmpeg_bin(),'-y','-v','error','-f','lavfi','-i',
                        'color=c=blue:s=64x64:r=10:d=1','-c:v','libx264',str(video)],check=True)
        cache_a=self.root/'cache-a';cache_b=self.root/'cache-b'
        with patch.object(media_assets,'ASSET_DIR',cache_a):
            info=media_assets.prepare_asset(video,'video.mp4',engine._ffmpeg_bin())
            self.project['background'].update(asset=info['asset'],name='video.mp4')
            client=app.test_client()
            response=client.post('/api/project/package/export',data={'project':json.dumps(self.project),
                'main':(io.BytesIO(self.song.read_bytes()),'Şarkı.wav')})
            self.assertEqual(response.status_code,200)
            exported=response.data;response.close()
        with patch.object(media_assets,'ASSET_DIR',cache_b):
            response=client.post('/api/project/package/import',data={'file':(io.BytesIO(exported),'project.cozy')})
            self.assertEqual(response.status_code,200,response.json)
            body=response.json;token=body['token']
            self.addCleanup(lambda:client.delete('/api/project/package/'+token))
            self.assertEqual(body['project'],validate_project(self.project))
            self.assertTrue(Path(media_assets.source_path(body['project']['background']['asset'])).is_file())
            audio=client.get(body['audio']['main']);self.assertEqual(audio.data,self.song.read_bytes());audio.close()
            self.assertEqual(client.get('/api/project/package/'+token+'/audio/unknown').status_code,404)
            self.assertEqual(client.delete('/api/project/package/'+token).status_code,204)
            self.assertEqual(client.get(body['audio']['main']).status_code,404)


if __name__=='__main__': unittest.main()
