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
from project import validate_project, validate_title
from project_package import build_package, unpack_package


class TitleTests(unittest.TestCase):
    def test_contract_and_reusable_components_in_package(self):
        for settings in [None,dict(rows=[]),dict(rows=[[dict(text=' ')]]),dict(rows=[[dict(font='remote')]]),dict(rows=[[dict(bold=1)]]),dict(accentColor='red')]:
            with self.subTest(settings=settings),self.assertRaises(ValueError):validate_title(settings)
        p=validate_project(dict(version=1,tracks=dict(main={}),visualLayers=[dict(id='t',type='title')],titlePresets=[dict(id='saved',name='Alt bant')]))
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_real_mp4_title_mixed_styles_background_icon_and_animation(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'black.mp4';ffmpeg=engine._ffmpeg_bin();wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            title=dict(rows=[[dict(text='RED ',color='#ff0000',size=120,bold=True),dict(text='BLUE',color='#0000ff',size=100,italic=True)]],backgroundColor='#204020',backgroundOpacity=100,accentColor='#ffffff',icon='diamond',enter='wipe',enterDuration=.5,exit='none')
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),visualLayers=[dict(id='t',type='title',width=90,until=1,title=title)]))
            target=root/'titles.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            counts=[]
            for time in [0,.25,.75]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(180,320,3);counts.append(int((frame.max(axis=2)>20).sum()))
                if time==.75:
                    self.assertGreater(int(((frame[:,:,0]>150)&(frame[:,:,2]<80)).sum()),40);self.assertGreater(int(((frame[:,:,2]>150)&(frame[:,:,0]<80)).sum()),40)
            self.assertEqual(counts[0],0);self.assertGreater(counts[1],100);self.assertGreater(counts[2],counts[1]*1.5)
