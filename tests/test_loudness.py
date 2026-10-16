import io
import json
import subprocess
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from flask import Flask
from pedalboard.io import AudioFile
import engine
from audio_render import render_project_audio
from loudness import analyze_loudness, normalize_loudness
from loudness_api import create_loudness_api
from project import validate_project
from render_process import RenderCancelled


class LoudnessTests(unittest.TestCase):
    def signal(self, seconds=4, frequency=1000, amplitude=.1):
        return np.stack([amplitude*np.sin(2*np.pi*frequency*np.arange(round(seconds*44100))/44100)]*2).astype(np.float32)

    def test_live_dsp_matches_canonical_gated_measurement_and_true_peak(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, data in [('tone',self.signal()),('gated',np.concatenate([self.signal(3),self.signal(3,amplitude=.000001),self.signal(3,amplitude=.04)],axis=1)),('intersample',self.signal(4,11025,.8))]:
                with self.subTest(name=name):
                    path=Path(folder)/'source.wav';wavfile.write(path,44100,data.T)
                    raw=Path(folder)/'source.f32';raw.write_bytes(data.T.copy().tobytes())
                    script="""const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync('static/js/loudness-dsp.js','utf8'));const bytes=fs.readFileSync(process.argv[1]),v=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),meter=new LoudnessDSP(44100);for(let i=0;i<v.length;i+=256){const n=Math.min(128,(v.length-i)/2),left=new Float32Array(n),right=new Float32Array(n);for(let j=0;j<n;j++){left[j]=v[i+j*2];right[j]=v[i+j*2+1];}meter.process([left,right]);}meter.flush();process.stdout.write(JSON.stringify(meter.snapshot()));"""
                    actual=json.loads(subprocess.run(['node','-e',script,str(raw)],text=True,capture_output=True,check=True).stdout)
                    reference=analyze_loudness(path,engine._ffmpeg_bin())
                    self.assertAlmostEqual(actual['integrated'],reference['integrated'],delta=.15)
                    self.assertAlmostEqual(actual['momentary'],reference['timeline'][-1][1],delta=.15)
                    self.assertAlmostEqual(actual['shortTerm'],reference['timeline'][-1][2],delta=.15)
                    self.assertAlmostEqual(actual['truePeak'],reference['truePeak'],delta=.2)

    def test_linear_dynamic_silent_and_cancelled_normalization(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.wav';wavfile.write(path,44100,self.signal().T)
            target=dict(loudnormI=-14,loudnormTP=-1,loudnormLRA=11)
            output,report,mode=normalize_loudness(path,Path(folder)/'normal.wav',engine._ffmpeg_bin(),target)
            self.assertEqual(mode,'linear');self.assertAlmostEqual(report['integrated'],-14,delta=.2);self.assertLessEqual(report['truePeak'],-1)
            data=self.signal(12,amplitude=.03);data[:,::22050]=.9;wavfile.write(path,44100,data.T)
            output,report,mode=normalize_loudness(path,Path(folder)/'dynamic.wav',engine._ffmpeg_bin(),target)
            self.assertEqual(mode,'dynamic');self.assertAlmostEqual(report['integrated'],-14,delta=.4);self.assertLessEqual(report['truePeak'],-.995)
            wavfile.write(path,44100,np.concatenate([self.signal(3),self.signal(3,amplitude=.000001),self.signal(3,amplitude=.04)],axis=1).T)
            output,report,mode=normalize_loudness(path,Path(folder)/'gated.wav',engine._ffmpeg_bin(),target)
            self.assertEqual(mode,'dynamic');self.assertAlmostEqual(report['integrated'],-14,delta=.2);self.assertLessEqual(report['truePeak'],-.995)
            wavfile.write(path,44100,np.zeros((44100,2),np.float32))
            output,report,mode=normalize_loudness(path,Path(folder)/'silent.wav',engine._ffmpeg_bin(),target)
            self.assertEqual(mode,'silence');self.assertIsNone(report['integrated'])
            event=threading.Event();event.set()
            with self.assertRaises(RenderCancelled):analyze_loudness(path,engine._ffmpeg_bin(),cancel=event)

    def test_actual_export_uses_custom_target_and_mono_speaker_gain(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=root/'mono.wav';data=self.signal()[0];wavfile.write(path,44100,data)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name='mono.wav',size=path.stat().st_size,lastModified=0,duration=4),loop=False,fadeIn=0,fadeOut=0)),effects=dict(speed=1,reverb=0),master=dict(loudnorm=True,loudnormI=-23,loudnormTP=-2,loudnormLRA=9,ceiling=0)))
            output=render_project_audio(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda data,_:data)
            report=analyze_loudness(output,engine._ffmpeg_bin());self.assertAlmostEqual(report['integrated'],-23,delta=.2)
            p['master']['loudnorm']=False
            output=render_project_audio(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(output) as handle:actual=handle.read(handle.frames)
            np.testing.assert_allclose(actual[0],data,atol=2e-7);np.testing.assert_allclose(actual[1],data,atol=2e-7)

    def test_api_analysis_preview_ranges_cancellation_and_validation(self):
        app=Flask(__name__);slot=threading.BoundedSemaphore(1);app.register_blueprint(create_loudness_api(engine._ffmpeg_bin,slot,lambda data,_:data));client=app.test_client()
        stream=io.BytesIO();wavfile.write(stream,44100,self.signal().T);audio=stream.getvalue()
        project=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name='source.wav',size=len(audio),lastModified=0,duration=4),loop=False,fadeIn=0,fadeOut=0)),effects=dict(speed=1,reverb=0),master=dict(ceiling=0)))
        def post(identifier=None,**changes):
            form=dict(id=identifier or str(uuid.uuid4()),project=json.dumps(project),action='normalize',previewStart='1',previewEnd='2',main=(io.BytesIO(audio),'source.wav'));form.update(changes)
            return client.post('/api/audio/loudness',data=form,content_type='multipart/form-data')
        response=post();self.assertEqual(response.status_code,200,response.data);result=response.json
        self.assertAlmostEqual(result['output']['integrated'],-14,delta=.2)
        url=result['previewUrl'];preview=client.get(url);self.assertEqual(preview.status_code,200)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'preview.wav';path.write_bytes(preview.data)
            with AudioFile(str(path)) as handle:self.assertEqual(handle.frames,44100)
        self.assertEqual(client.get(url,headers={'Range':'bytes=0-99'}).status_code,206)
        self.assertEqual(client.delete(url.removesuffix('/audio')).status_code,200);self.assertEqual(client.get(url).status_code,404)
        identifier=str(uuid.uuid4());client.delete('/api/audio/loudness/'+identifier);self.assertEqual(post(identifier).status_code,409)
        for changes in [dict(previewStart='nan'),dict(previewEnd='1000'),dict(action='bad'),dict(project='{}'),dict(id='../bad'),dict(main=(io.BytesIO(b'bad'),'source.wav'))]:
            with self.subTest(changes=changes):self.assertEqual(post(**changes).status_code,400)
        slot.acquire()
        try:self.assertEqual(post().status_code,429)
        finally:slot.release()
