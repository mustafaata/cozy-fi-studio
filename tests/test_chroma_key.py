import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
from scipy.io import wavfile
import engine
import media_assets
from overlay_assets import prepare_overlay, overlay_path
from project import validate_project


class ChromaKeyTests(unittest.TestCase):
    def test_contract_is_strict_and_legacy_profiles_are_independent(self):
        p=validate_project(dict(version=1,tracks=dict(main={}),videoClips=[dict(id='v',asset='a'*64)],visualLayers=[dict(id='image',type='image',asset='a'*64)]))
        self.assertEqual(p['videoClips'][0]['chroma'],p['visualLayers'][0]['chroma'])
        p['videoClips'][0]['chroma']['enabled']=True;self.assertFalse(p['visualLayers'][0]['chroma']['enabled']);self.assertEqual(validate_project(p),p)
        for value in [None,[],dict(enabled=1),dict(color='red'),dict(tolerance=float('nan')),dict(softness=-1),dict(despill=True),dict(despill=101)]:
            for scope in ['videoClips','visualLayers']:
                q=copy.deepcopy(p);q[scope][0]['chroma']=value
                with self.subTest(scope=scope,value=value),self.assertRaises(ValueError):validate_project(q)

    def test_keyed_foreground_composites_over_background_in_real_mp4(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'blue.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=blue:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            image=Image.new('RGB',(96,64),'#00ff00');ImageDraw.Draw(image).rectangle((32,16,64,48),fill='#ff0000');blob=io.BytesIO();image.save(blob,format='PNG');overlay=prepare_overlay(blob.getvalue(),'green.png')
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),
                background=dict(asset=info['asset']),visualLayers=[dict(id='foreground',type='image',asset=overlay['asset'],width=100,until=1,chroma=dict(enabled=True,tolerance=10,softness=20,despill=50))]))
            target=root/'key.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset'])),visual_paths=dict(foreground=overlay_path(overlay['asset']))),str(target))
            self.assertTrue(ok,message)
            result=subprocess.run([ffmpeg,'-v','error','-ss','0.5','-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
            frame=np.frombuffer(result.stdout,dtype=np.uint8).reshape(64,96,3)
            self.assertGreater(frame[32,10,2],200);self.assertLess(frame[32,10,1],20)
            self.assertGreater(frame[32,48,0],200);self.assertLess(frame[32,48,1],20)
