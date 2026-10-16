import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from pedalboard.io import AudioFile
import engine
from audio_render import SAMPLE_RATE, render_project_audio
from project import validate_project
from project_package import build_package, unpack_package


class MicrophoneRecordingTests(unittest.TestCase):
    def test_punch_take_keeps_original_media_and_renders_only_new_voice_in_range(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);files={}
            for kind,seconds,value in [('main',2,0),('rain',2,.1),('voice_take',.5,.25)]:
                path=root/f'{kind}.wav'
                with AudioFile(str(path),'w',SAMPLE_RATE,2,bit_depth=24) as handle:handle.write(np.full((2,round(SAMPLE_RATE*seconds)),value,dtype=np.float32))
                files[kind]=str(path)
            def source(kind,seconds):return dict(name=Path(files[kind]).name,size=Path(files[kind]).stat().st_size,lastModified=0,duration=seconds)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=source('main',2)),rain=dict(source=source('rain',2),loop=False)),effects=dict(speed=1,reverb=0),master=dict(ceiling=0)))
            script='''const fs=require('node:fs'),vm=require('node:vm'),input=JSON.parse(fs.readFileSync(0,'utf8'));const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},input});for(const name of ['project','parameter-curves','automation-editing','microphone-recording'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);process.stdout.write(vm.runInContext(`(()=>{const p=validateProject(input.project);attachMicrophoneTake(p,{target:'rain',replace:true,start:.5,shift:0},input.source,'voice_take');return JSON.stringify(validateProject(p));})()`,c));'''
            rendered=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,source=source('voice_take',.5))),capture_output=True,text=True,check=True);p=validate_project(json.loads(rendered.stdout))
            archive=io.BytesIO();build_package(archive,p,{f'media/{kind}':path for kind,path in files.items()});archive.seek(0);(root/'opened').mkdir();opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,p)
            path=render_project_audio(p,files,str(root),engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(path) as handle:data=handle.read(handle.frames)
            before=data[:,round(.25*SAMPLE_RATE)].mean();inside=data[:,round(.75*SAMPLE_RATE)].mean();after=data[:,round(1.5*SAMPLE_RATE)].mean()
            self.assertAlmostEqual(before,.1,places=4);self.assertAlmostEqual(inside,.25,places=4);self.assertAlmostEqual(after,.1,places=4);self.assertEqual(p['tracks']['rain']['source']['name'],'rain.wav')
