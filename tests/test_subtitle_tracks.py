import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile
import engine
import media_assets
from project import validate_project
from project_package import build_package, unpack_package


class SubtitleTrackTests(unittest.TestCase):
    def test_active_editor_is_authoritative_and_inactive_language_roundtrips(self):
        p=validate_project(dict(version=1,tracks=dict(main={}),lyrics=dict(lines=[dict(id='en-line',text='Hello',start=0,end=1)]),subtitles=dict(active='en'),subtitleTracks=[dict(id='en',language='en',lyrics={}),dict(id='tr',language='tr',lyrics=dict(lines=[dict(id='tr-line',text='Merhaba',start=0,end=1)]))]))
        self.assertEqual(p['subtitleTracks'][0]['lyrics'],p['lyrics']);self.assertEqual(p['subtitleTracks'][1]['lyrics']['lines'][0]['text'],'Merhaba')
        for value in [dict(subtitles=dict(active='bad')),dict(subtitleTracks=[dict(id='x',language='invalid!')] ),dict(subtitleTracks=[dict(id='en',lyrics=dict(color='red'))])]:
            q=copy.deepcopy(p);q.update(value)
            with self.subTest(value=value),self.assertRaises(ValueError):validate_project(q)
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_real_mp4_renders_only_active_language_style(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'black.mp4';ffmpeg=engine._ffmpeg_bin();wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),lyrics=dict(color='#ff0000',fontSize=120,animation='none',glowIntensity=0,lines=[dict(id='en-line',text='Hello',start=0,end=1)]),subtitles=dict(active='en'),subtitleTracks=[dict(id='en',language='en'),dict(id='tr',language='tr',lyrics=dict(color='#0000ff',lines=[dict(id='tr-line',text='Merhaba',start=0,end=1)]))]))
            target=root/'subtitles.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            raw=subprocess.run([ffmpeg,'-v','error','-ss','0.5','-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(180,320,3)
            self.assertGreater(int(((frame[:,:,0]>120)&(frame[:,:,2]<80)).sum()),40);self.assertEqual(int(((frame[:,:,2]>120)&(frame[:,:,0]<80)).sum()),0)
