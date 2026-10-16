import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import numpy as np
from pedalboard.io import AudioFile
import engine
from project import validate_project, audio_channel_order
from audio_dynamics import DynamicsProcessor
from audio_render import render_project_audio


class SidechainTests(unittest.TestCase):
    def project(self, **side):
        return validate_project(dict(version=1,tracks=dict(main=dict(sidechain=dict(source='t:rain',**side)),rain={}),audioBuses=[dict(id='group',name='Group')]))

    def test_references_filters_and_group_sidechain_cycles_are_rejected(self):
        p=self.project(enabled=True);self.assertLess(audio_channel_order(p).index('t:rain'),audio_channel_order(p).index('t:main'))
        for side in [dict(source='t:main'),dict(source='b:missing'),dict(highpass=1000,lowpass=500),dict(attack=True),dict(depth=-61)]:
            q=copy.deepcopy(p);q['tracks']['main']['sidechain'].update(side)
            with self.subTest(side=side),self.assertRaises(ValueError):validate_project(q)
        q=copy.deepcopy(p);q['tracks']['rain']['bus']='group';q['audioBuses'][0]['sidechain'].update(enabled=True,source='t:main');q['tracks']['main']['sidechain']['source']='b:group'
        with self.assertRaises(ValueError):validate_project(q)
        q=copy.deepcopy(p);q['tracks']['rain']['sidechain'].update(enabled=True,source='t:main')
        with self.assertRaises(ValueError):validate_project(q)

    def test_filtered_key_duck_pump_hold_and_javascript_stream_parity(self):
        sr=44100;frames=22050;t=np.arange(frames)/sr
        target=np.full((2,frames),.2,np.float32);key=np.stack([.5*np.sin(2*np.pi*1000*t)]*2).astype(np.float32);key[:,6000:]=0
        for character in ['compress','duck','pump']:
            p=self.project(enabled=True,character=character,attack=1,release=20,hold=100,threshold=-30)
            channel=p['tracks']['main'];processor=DynamicsProcessor(channel['dynamics'],sr,channel['sidechain']);result=processor.process(target,key)
            self.assertLess(float(result[0,5000]),.07);self.assertGreater(float(result[0,-1]),.19)
            if character=='pump':self.assertLess(float(result[0,9000]),.07)
            processor=DynamicsProcessor(channel['dynamics'],sr,channel['sidechain']);split=np.concatenate([processor.process(target[:,first:first+173],key[:,first:first+173]) for first in range(0,frames,173)],axis=1);np.testing.assert_array_equal(split,result)
            script="""const fs=require('node:fs'),vm=require('node:vm'),v=JSON.parse(fs.readFileSync(0,'utf8'));for(const name of ['sidechain-dsp','dynamics-dsp'])vm.runInThisContext(fs.readFileSync('static/js/'+name+'.js','utf8'));const dsp=new DynamicsDSP(44100);dsp.configure(v.channel.dynamics,v.channel.sidechain);const output=v.target.map(x=>new Float32Array(x.length));dsp.process(v.target.map(x=>new Float32Array(x)),output,v.key.map(x=>new Float32Array(x)));process.stdout.write(JSON.stringify(output.map(x=>Array.from(x))));"""
            response=subprocess.run(['node','-e',script],input=json.dumps(dict(channel=channel,target=target.tolist(),key=key.tolist())),text=True,capture_output=True,check=True);np.testing.assert_allclose(json.loads(response.stdout),result,atol=3e-8)
        channel['sidechain'].update(listen=True,lowpass=200,highpass=20);filtered=DynamicsProcessor(channel['dynamics'],sr,channel['sidechain']).process(target,key)
        self.assertLess(np.sqrt(np.mean(filtered[:,:5000]**2)),.08)

    def test_real_group_key_controls_other_layer_on_project_clock(self):
        sr=44100;t=np.arange(sr)/sr
        with tempfile.TemporaryDirectory() as folder:
            files={};tracks={}
            for kind in ['main','rain']:
                path=Path(folder)/(kind+'.wav');data=np.full((2,sr),.2,np.float32) if kind=='main' else np.stack([.5*np.sin(2*np.pi*1000*t)*((t>=.2)&(t<.4))]*2).astype(np.float32)
                with AudioFile(str(path),'w',sr,2,bit_depth=24) as handle:handle.write(data)
                files[kind]=str(path);tracks[kind]=dict(source=dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=1),loop=False,fadeIn=0,fadeOut=0,pan=1 if kind=='main' else -1)
            tracks['rain']['bus']='group';tracks['main']['sidechain']=dict(enabled=True,source='b:group',character='duck',threshold=-30,depth=-18,attack=1,release=20)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks=tracks,audioBuses=[dict(id='group',name='Group')]))
            result=render_project_audio(p,files,folder,engine._ffmpeg_bin(),lambda samples,_:samples)
            with AudioFile(result) as handle:samples=handle.read(handle.frames)
            self.assertGreater(samples[1,4410],.39);self.assertLess(samples[1,13230],.07);self.assertGreater(samples[1,35280],.39)
