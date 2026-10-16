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
from project import validate_project, validate_particles
from project_package import build_package, unpack_package


class ParticleTests(unittest.TestCase):
    def test_contract_budget_and_media_free_package(self):
        for settings in [None,dict(density=1.5),dict(seed=.2),dict(life=0),dict(color='red'),dict(reactivity=True)]:
            with self.subTest(settings=settings),self.assertRaises(ValueError):validate_particles(settings)
        with self.assertRaises(ValueError):validate_project(dict(version=1,tracks=dict(main={}),visualLayers=[dict(id=f'p{i}',type='particles',particles=dict(density=600)) for i in range(7)]))
        p=validate_project(dict(version=1,tracks=dict(main={}),visualLayers=[dict(id='p',type='particles')]))
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_real_mp4_reacts_to_selected_band_and_silence(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'black.mp4';ffmpeg=engine._ffmpeg_bin()
            t=np.arange(44100)/44100;audio=.5*np.sin(2*np.pi*440*t);audio[t>.5]=0;wavfile.write(main,44100,(audio*32767).astype(np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),video=dict(vizType='none',bassEffects=[]),lyrics=dict(glowIntensity=0,bassEffects=[]),background=dict(asset=info['asset']),visualLayers=[dict(id='p',type='particles',width=100,until=1,particles=dict(style='snow',band='mid',size=25,density=300,reactivity=100,ratio=2/3))]))
            target=root/'particles.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            counts=[]
            for time in [.25,.85]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8);counts.append(int((frame>40).sum()))
            self.assertGreater(counts[0],50);self.assertEqual(counts[1],0)
