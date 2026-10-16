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
from project import validate_project, validate_motion_path


class MotionPathTests(unittest.TestCase):
    def test_contract_keeps_independent_paths_and_rejects_corrupt_nodes(self):
        node=[0,0,0,0,0,0,0,'linear','linear']
        for value in [None,[],dict(enabled=1),dict(nodes=[node[:-1]]),dict(nodes=[node,node]),dict(nodes=[[0,True,0,0,0,0,0,'linear','linear']]),dict(nodes=[[0,0,0,0,0,201,0,'bezier','linear']])]:
            with self.subTest(value=value),self.assertRaises(ValueError):validate_motion_path(value)
        p=validate_project(dict(version=1,tracks=dict(main={}),video=dict(motionPath=dict(enabled=True,nodes=[node])),visualLayers=[dict(id='text',text='Title')]))
        self.assertEqual(validate_project(p),p);self.assertFalse(p['visualLayers'][0]['motionPath']['enabled'])

    def test_real_mp4_composes_video_motion_and_spatial_bezier_image_path(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'blue.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=blue:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            blob=io.BytesIO();Image.new('RGB',(32,32),'red').save(blob,format='PNG');overlay=prepare_overlay(blob.getvalue(),'red.png')
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),
                video=dict(motionPath=dict(enabled=True,nodes=[[0,25,0,0,0,0,0,'linear','linear']])),
                visualLayers=[dict(id='moving',type='image',asset=overlay['asset'],width=20,until=1,motionPath=dict(enabled=True,nodes=[[0,-25,0,0,0,0,-20,'bezier','linear'],[1,25,0,0,-20,0,0,'linear','linear']]))]))
            target=root/'motion.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset'])),visual_paths=dict(moving=overlay_path(overlay['asset']))),str(target));self.assertTrue(ok,message)
            for time,expected in [(0,(24,32)),(.5,(48,22.4))]:
                result=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                frame=np.frombuffer(result.stdout,dtype=np.uint8).reshape(64,96,3);y,x=np.where((frame[:,:,0]>180)&(frame[:,:,1]<50)&(frame[:,:,2]<50))
                self.assertGreater(len(x),200);self.assertAlmostEqual(x.mean(),expected[0]-.5,delta=1);self.assertAlmostEqual(y.mean(),expected[1]-.5,delta=1)
                self.assertLess(frame[2,2].max(),15);self.assertGreater(frame[32,90,2],200)
