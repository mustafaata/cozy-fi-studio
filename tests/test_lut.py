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


class LutTests(unittest.TestCase):
    def table(self):
        return dict(id='inverse',name='Ters renk',size=2,data=[1-v for i in range(8) for v in [i%2,(i//2)%2,i//4]])

    def test_contract_and_portable_package_preserve_tables_and_reject_corruption(self):
        p=validate_project(dict(version=1,tracks=dict(main={}),luts=[self.table()],video=dict(lut=dict(table='inverse',enabled=True))))
        self.assertEqual(validate_project(p),p)
        for key,value in [('size',2.5),('data',[0]*23),('data',[float('nan')]*24),('data',[True]*24),('domainMax',[0,1,1]),('domainMin',[1,1])]:
            q=copy.deepcopy(p);q['luts'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):validate_project(q)
        for settings in [dict(table='missing',enabled=True),dict(table='inverse',enabled=1),dict(table='inverse',intensity=101),dict(table='inverse',order='other')]:
            q=copy.deepcopy(p);q['video']['lut']=settings
            with self.assertRaises(ValueError):validate_project(q)
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_real_mp4_applies_cube_to_single_background_and_clip_with_expected_intensity(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'blue.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            base=dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),luts=[self.table()])
            for clip,intensity,expected in [(False,100,[255,255,0]),(True,50,[128,128,128])]:
                p=copy.deepcopy(base);settings=dict(table='inverse',enabled=True,intensity=intensity)
                if clip:p['videoClips']=[dict(id='one',asset=info['asset'],start=0,end=1,offset=0,lut=settings)]
                else:p['video']=dict(lut=settings)
                target=root/f'{clip}.mp4';ok,message=engine.process_and_render(validate_project(p),dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
                result=subprocess.run([ffmpeg,'-v','error','-ss','0.5','-i',str(target),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                for actual,want in zip(result.stdout,expected):self.assertAlmostEqual(actual,want,delta=7)
