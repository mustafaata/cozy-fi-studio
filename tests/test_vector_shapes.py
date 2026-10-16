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
from project import validate_project, validate_shape
from project_package import build_package, unpack_package


class VectorShapeTests(unittest.TestCase):
    def test_strict_shape_contract_and_package_without_media(self):
        for shape in [None, [], dict(fillColor='red'), dict(dash=[0]), dict(kind='path',closed=True), dict(points=[[0,0,0,0,0,0],[True,0,0,0,0,0]]), dict(drawStart=1200,drawDuration=1)]:
            with self.subTest(shape=shape), self.assertRaises(ValueError):validate_shape(shape)
        p=validate_project(dict(version=1,tracks=dict(main={}),visualLayers=[dict(id='s',type='shape',shape=dict(kind='arrow',dash=[8,4]))]))
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,files=unpack_package(archive,folder)
            self.assertEqual(opened,p);self.assertEqual(files,{})

    def test_real_mp4_draws_contour_then_fill_and_moves_shape(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'blue.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=blue:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),visualLayers=[dict(id='s',type='shape',width=40,until=1,shape=dict(fillColor='#ff0000',strokeColor='#ffffff',strokeWidth=30,drawDuration=.5),motionPath=dict(enabled=True,nodes=[[0,-20,0,0,0,0,0,'linear','linear'],[1,20,0,0,0,0,0,'linear','linear']]))]))
            target=root/'shapes.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            for time in [0,.25,.75]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(64,96,3);red=(frame[:,:,0]>180)&(frame[:,:,1]<60)&(frame[:,:,2]<60)
                if time<.5:self.assertEqual(int(red.sum()),0)
                else:
                    y,x=np.where(red);self.assertGreater(len(x),800);self.assertAlmostEqual(x.mean(),57.1,delta=1.5);self.assertAlmostEqual(y.mean(),31.5,delta=1)
                if time==.25:self.assertGreater(int(((frame[:,:,0]>160)&(frame[:,:,1]>160)).sum()),40)
