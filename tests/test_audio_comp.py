import copy
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


class AudioCompTests(unittest.TestCase):
    def test_comp_contract_requires_live_sources_valid_mix_state_and_ordered_coverage(self):
        source=dict(name='take.wav',size=1,lastModified=0,duration=2)
        value=dict(version=1,effects=dict(speed=1),tracks={k:dict(source=source,loop=False) for k in ['main','rain','fire','comp_out']},audioComps=[dict(id='comp',takes=['rain','fire'],output='comp_out',segments=[[0,1,'rain'],[1,2,'fire']],mutedBefore=dict(rain=False,fire=False),soloBefore=dict(rain=False,fire=False))])
        p=validate_project(value);self.assertEqual(validate_project(p),p)
        for update in [dict(takes=['rain','main']),dict(takes=['rain',[]]),dict(output='missing'),dict(segments=[[0,1,'rain'],[.5,2,'fire']]),dict(segments=[[0,3,'rain']]),dict(mutedBefore=dict(rain=1,fire=False)),dict(soloBefore={}),dict(crossfade=2)]:
            q=copy.deepcopy(p);q['audioComps'][0].update(update)
            with self.subTest(update=update),self.assertRaises(ValueError):validate_project(q)

    def test_comp_float_wave_package_and_final_mix_match_selected_raw_takes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);files={}
            for kind,value in [('main',0),('rain',.2),('fire',.4)]:
                path=root/f'{kind}.wav'
                with AudioFile(str(path),'w',SAMPLE_RATE,2,bit_depth=24) as handle:handle.write(np.full((2,SAMPLE_RATE*2),value,dtype=np.float32))
                files[kind]=str(path)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks={k:dict(source=dict(name=Path(path).name,size=Path(path).stat().st_size,lastModified=0,duration=2),loop=False) for k,path in files.items()}))
            target=root/'comp.wav'
            script='''const fs=require('node:fs'),vm=require('node:vm'),input=JSON.parse(fs.readFileSync(0,'utf8'));const c=vm.createContext({EventTarget,Event,Float32Array,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},input});for(const n of ['project','audio-channels','audio-comp'])vm.runInContext(fs.readFileSync('static/js/'+n+'.js','utf8'),c);const result=vm.runInContext(`(()=>{const p=validateProject(input.project),comp={...projectFields({},'audioComp'),id:'performance',takes:['rain','fire'],segments:[[0,1,'rain'],[1,2,'fire']],crossfade:.1},buffers=Object.fromEntries([['rain',.2],['fire',.4]].map(([id,value])=>[id,{sampleRate:1000,length:2000,numberOfChannels:1,getChannelData:()=>new Float32Array(2000).fill(value)}])),rendered=renderAudioComp(audioCompInputs(p,comp,buffers)),wave=encodeCompWave(rendered);attachAudioComp(p,comp,{name:'comp.wav',size:wave.bytes.byteLength,lastModified:0,duration:2},'comp_out');return {project:validateProject(p),bytes:wave.bytes};})()`,c);fs.writeFileSync(process.argv[1],new Uint8Array(result.bytes));process.stdout.write(JSON.stringify(result.project));'''
            response=subprocess.run(['node','-e',script,str(target)],input=json.dumps(dict(project=p)),capture_output=True,text=True,check=True);p=validate_project(json.loads(response.stdout));files['comp_out']=str(target)
            archive=io.BytesIO();build_package(archive,p,{f'media/{k}':v for k,v in files.items()});archive.seek(0);(root/'opened').mkdir();opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,p)
            with AudioFile(str(target)) as handle:raw=handle.read(handle.frames);self.assertEqual(handle.samplerate,48000)
            self.assertAlmostEqual(raw[:,48000].mean(),.6/np.sqrt(2),places=5)
            mixed=render_project_audio(p,files,str(root),engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(mixed) as handle:data=handle.read(handle.frames)
            self.assertAlmostEqual(data[:,round(.5*SAMPLE_RATE)].mean(),.2,places=4);self.assertAlmostEqual(data[:,round(1.5*SAMPLE_RATE)].mean(),.4,places=4);self.assertAlmostEqual(data[:,SAMPLE_RATE].mean(),.6/np.sqrt(2),delta=.001)
