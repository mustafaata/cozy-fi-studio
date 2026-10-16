import io
import json
import threading
from pathlib import Path
import subprocess
import tempfile
import unittest
import numpy as np
from scipy.io import wavfile
from flask import Flask
from pedalboard.io import AudioFile
import engine
from audio_render import render_project_audio
from project_package import build_package,unpack_package
from audio_warp import render_audio_warp
from audio_warp_api import create_audio_warp_api
from project import validate_audio_warp,validate_project


class AudioWarpTests(unittest.TestCase):
    def test_browser_authored_artifact_package_and_real_mix_preserve_rendered_mapping(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);files={};tracks={}
            for kind,data in [('main',np.zeros((2,132300),np.float32)),('rain',self.signal())]:
                path=root/(kind+'.wav');wavfile.write(path,44100,data.T);files[kind]=str(path);tracks[kind]=dict(source=dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=data.shape[1]/44100),loop=False,fadeIn=0,fadeOut=0)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks=tracks));definition=dict(id='warp',source='rain',start=0,end=1,offset=.2,markers=[[0,0],[.5,.5],[1,1.5]])
            samples=render_audio_warp(self.signal(),44100,definition);path=root/'warp.wav';wavfile.write(path,44100,samples.T);info=dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=samples.shape[1]/44100)
            script="""const fs=require('node:fs'),vm=require('node:vm'),v=JSON.parse(fs.readFileSync(0,'utf8'));const c=vm.createContext({Event,EventTarget,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},v});for(const name of ['project','audio-warp'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);process.stdout.write(vm.runInContext('(()=>{const p=validateProject(v.project);attachAudioWarp(p,v.definition,v.info,"warp_output");return JSON.stringify(validateProject(p));})()',c));"""
            response=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,definition=definition,info=info)),text=True,capture_output=True,check=True);p=validate_project(json.loads(response.stdout));files['warp_output']=str(path)
            archive=io.BytesIO();build_package(archive,p,{f'media/{k}':v for k,v in files.items()});archive.seek(0);(root/'opened').mkdir();opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,p)
            output=render_project_audio(p,files,folder,engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(output) as handle:result=handle.read(handle.frames)
            first=round(.2*44100);np.testing.assert_allclose(result[:,first+1000:first+samples.shape[1]-1000],samples[:,1000:-1000],atol=1e-6)
            np.testing.assert_array_equal(result[:,:first],0)

    def signal(self):
        return np.stack([.2*np.sin(2*np.pi*440*np.arange(44100)/44100)]*2).astype(np.float32)
    def frequency(self,audio):
        data=audio[0,1000:-1000];spectrum=np.abs(np.fft.rfft(data*np.hanning(len(data))))
        return np.argmax(spectrum)*44100/len(data)

    def test_independent_speed_pitch_and_exact_marker_duration(self):
        source=self.signal();definition=dict(end=1,markers=[[0,0],[1,.5]])
        preserved=render_audio_warp(source,44100,definition);self.assertEqual(preserved.shape,(2,22050));self.assertAlmostEqual(self.frequency(preserved),440,delta=5)
        pitched=render_audio_warp(source,44100,dict(definition,preservePitch=False));self.assertAlmostEqual(self.frequency(pitched),880,delta=5)
        shifted=render_audio_warp(source,44100,dict(definition,transpose=12));self.assertAlmostEqual(self.frequency(shifted),880,delta=5)
        identity=render_audio_warp(source,44100,dict(end=1,markers=[[0,0],[.5,.5],[1,1]]));np.testing.assert_allclose(identity,source,atol=3e-8)

    def test_transient_markers_and_validation(self):
        source=np.zeros((2,44100),np.float32);source[:,11025:11035]=.5;source[:,33075:33085]=.5
        output=render_audio_warp(source,44100,dict(end=1,markers=[[0,0],[.5,.25],[1,1]],crossfade=.02))
        for time in [.125,.625]:
            center=round(time*44100);area=np.abs(output[0,center-1500:center+1500]);peak=center-1500+int(np.argmax(area));self.assertLess(abs(peak/44100-time),.025);self.assertGreater(float(area.max()),.1)
        for bad in [dict(markers=[[0,0],[1,0]]),dict(markers=[[0,0],[.5,.2],[.4,.3],[1,1]]),dict(markers=[[0,0],[1,10]]),dict(transpose=True),dict(start=.1),dict(end=121),dict(markers=[[0,0],[1,float('nan')]])]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):validate_audio_warp(bad)

    def test_api_roundtrip_bounds_busy_and_malformed_input(self):
        app=Flask(__name__);slot=threading.BoundedSemaphore(1);app.register_blueprint(create_audio_warp_api(slot));client=app.test_client()
        def post(definition=None,data=None):
            wave=io.BytesIO();wavfile.write(wave,44100,self.signal().T);wave.seek(0)
            return client.post('/api/audio/warp',data=dict(definition=json.dumps(definition or dict(end=1,markers=[[0,0],[1,.5]])),audio=(io.BytesIO(data) if data is not None else wave,'source.wav')),content_type='multipart/form-data')
        response=post();self.assertEqual(response.status_code,200);sr,result=wavfile.read(io.BytesIO(response.data));self.assertEqual(sr,44100);self.assertEqual(result.shape,(22050,2))
        self.assertEqual(post(dict(markers=[[0,0],[1,0]])).status_code,400);self.assertEqual(post(data=b'not wave').status_code,400)
        slot.acquire()
        try:self.assertEqual(post().status_code,429)
        finally:slot.release()
        self.assertEqual(client.post('/api/audio/warp',data={}).status_code,400)

    def test_project_requires_live_unique_warp_sources_outputs_and_matching_duration(self):
        source=dict(name='s.wav',size=1,lastModified=0,duration=2)
        p=validate_project(dict(version=1,tracks=dict(main=dict(source=source),rain=dict(source=source),out=dict(source=source)),audioWarps=[dict(id='warp',source='rain',output='out',end=2,markers=[[0,0],[2,2]])]))
        self.assertEqual(validate_project(p),p)
        for field,value in [('source','missing'),('output','main'),('markers',[[0,0],[2,1]]),('source','out')]:
            q=json.loads(json.dumps(p));q['audioWarps'][0][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):validate_project(q)
