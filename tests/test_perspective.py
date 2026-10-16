import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from scipy.io import wavfile
import engine
import media_assets
from overlay_assets import prepare_overlay, overlay_path
from project import validate_project, validate_perspective


class PerspectiveTests(unittest.TestCase):
    def test_quad_and_key_contracts_reject_invalid_geometry_and_animated_collapse(self):
        identity=[[0,0],[100,0],[100,100],[0,100]]
        rotated=identity[2:]+identity[:2]
        for value in [None,[],dict(enabled=1),dict(points=[[0,0],[100,100],[100,0],[0,100]]),dict(points=[[0,0],[100,0],[100,0],[0,100]]),
                      dict(keys=[[0,identity,'linear'],[1,rotated,'linear']]),dict(keys=[[1,identity,'smooth'],[0,identity,'linear']]),dict(points=[[False,0],[100,0],[100,100],[0,100]])]:
            with self.subTest(value=value),self.assertRaises(ValueError):validate_perspective(value)
        settings=validate_perspective(dict(enabled=True,keys=[[0,identity,'hold'],[1,rotated,'linear']]))
        p=validate_project(dict(version=1,tracks=dict(main={}),video=dict(perspective=settings),visualLayers=[dict(id='t',text='Caption')]))
        self.assertEqual(validate_project(p),p);self.assertFalse(p['visualLayers'][0]['perspective']['enabled'])

    def test_real_mp4_warps_image_with_transparent_outside_and_animated_corners(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'blue.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=blue:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            blob=io.BytesIO();Image.new('RGB',(96,64),'red').save(blob,format='PNG');overlay=prepare_overlay(blob.getvalue(),'red.png')
            small=[[35,20],[65,30],[75,80],[25,70]];large=[[10,10],[90,10],[90,90],[10,90]]
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),
                background=dict(asset=info['asset']),visualLayers=[dict(id='foreground',type='image',asset=overlay['asset'],width=100,until=1,perspective=dict(enabled=True,keys=[[0,small,'hold'],[.5,large,'hold']]))]))
            target=root/'perspective.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset'])),visual_paths=dict(foreground=overlay_path(overlay['asset']))),str(target));self.assertTrue(ok,message)
            frames=[]
            for time in [.25,.75]:
                result=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                frames.append(np.frombuffer(result.stdout,dtype=np.uint8).reshape(64,96,3))
            for frame in frames:self.assertGreater(frame[32,48,0],200);self.assertGreater(frame[2,2,2],200)
            self.assertGreater(frames[0][32,18,2],200);self.assertGreater(frames[1][32,18,0],200)
