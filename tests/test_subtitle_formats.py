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
from lyrics import validate_lines
from project import SCHEMA, validate_project
from project_package import build_package, unpack_package


class SubtitleFormatTests(unittest.TestCase):
    def test_trusted_side_rejects_invalid_partial_style_and_packages_valid_style(self):
        row=dict(id='cue',text='Hello',start=0,end=1,cueStyle=dict(x=25,y=20,font='Caveat',bold=True,anchor='middle',color='#ff0000'))
        for style in [None,[],dict(x=True),dict(y=101),dict(bold=1),dict(font=''),dict(color=''),dict(html='<script>'),dict(anchor='invalid')]:
            invalid=copy.deepcopy(row);invalid['cueStyle']=style
            with self.subTest(style=style),self.assertRaises(ValueError):validate_lines([invalid],SCHEMA['lyricLimits'])
        p=validate_project(dict(version=1,tracks=dict(main={}),lyrics=dict(lines=[row])))
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_real_mp4_respects_cue_font_style_position_and_vertical_anchor(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'black.mp4';ffmpeg=engine._ffmpeg_bin();wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),lyrics=dict(color='#0000ff',animation='none',glowIntensity=0,lines=[dict(id='cue',text='Title',start=0,end=1,cueStyle=dict(x=25,y=40,anchor='bottom',font='Caveat',fontSize=120,bold=True,italic=True,color='#ff0000',outline=0))])))
            target=root/'cue-style.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            raw=subprocess.run([ffmpeg,'-v','error','-ss','0.5','-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(180,320,3);y,x=np.where((frame[:,:,0]>120)&(frame[:,:,2]<80))
            self.assertGreater(len(x),30);self.assertLess(abs(x.mean()-80),12);self.assertLess(y.max(),76);self.assertLess(y.mean(),65);self.assertEqual(int(((frame[:,:,2]>120)&(frame[:,:,0]<80)).sum()),0)
