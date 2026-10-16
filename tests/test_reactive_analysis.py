import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
import numpy as np
from flask import Flask
from pedalboard.io import AudioFile
import engine
from project import SCHEMA, validate_project, validate_creative_reactive_fx
from reactive_analysis import ReactiveSpectrum, analyze_reactive_project
from reactive_api import create_reactive_api
from render_process import RenderCancelled


def signal():
    t=np.arange(44100)/44100
    wave=(.2*np.sin(2*np.pi*110*t)*(t>.05)*(t<.15)).astype(np.float32)
    return np.stack([wave,-wave])

def unpack(value):
    return np.frombuffer(base64.b64decode(value['data']),dtype=np.uint8).reshape(value['frames'],value['bands'])


class ReactiveAnalysisTests(unittest.TestCase):
    def project(self):
        return validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name='tone.wav',size=1,lastModified=0,duration=1),end=1,fadeIn=0,fadeOut=0)),effects=dict(speed=1,reverb=0)))

    def test_streaming_spectrum_is_chunk_invariant_and_stereo_safe(self):
        samples=signal();results=[]
        for block_size in (127,735,8192):
            spectrum=ReactiveSpectrum(1)
            for first in range(0,44100,block_size):spectrum.consume(samples[:,first:first+block_size],first)
            results.append(unpack(spectrum.finish(1)))
        for result in results[1:]:np.testing.assert_array_equal(result,results[0])
        self.assertGreater(results[0].max(),200)
        self.assertFalse(results[0][0].any())
        self.assertFalse(results[0][20:].any())
        cancel=threading.Event();spectrum=ReactiveSpectrum(1,cancel);cancel.set()
        with self.assertRaises(RenderCancelled):spectrum.finish(1)

    def test_real_track_bus_and_master_pre_post_taps(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'input.wav'
            with AudioFile(str(source),'w',44100,2,bit_depth=24) as handle:handle.write(signal())
            for target in ('t:main','b:echo','master'):
                project=self.project();fx=dict(preset='AFX-11',amount=100,parameters=dict(delay=100,tone=18000))
                if target=='t:main':project['tracks']['main']['audioFx']=fx
                else:
                    project['audioBuses']=[dict(id='echo',name='Echo',audioFx=fx)];project['tracks']['main']['bus']='echo'
                outputs={}
                for point in ('pre','post'):
                    with self.subTest(target=target,point=point):
                        project['video']['reactiveAnalysis']=dict(source=target,point=point);project=validate_project(project)
                        work=root/(target.replace(':','-')+point);work.mkdir()
                        outputs[point]=unpack(analyze_reactive_project(project,dict(main=str(source)),str(work),engine._ffmpeg_bin(),lambda data,_:data))
                if target!='master':
                    self.assertFalse(outputs['post'][:9].any())
                    self.assertGreater(outputs['pre'][4:9].max(),100)
                    self.assertGreater(outputs['post'][10:16].max(),100)
                    self.assertFalse(np.array_equal(outputs['pre'],outputs['post']))
                else:
                    # Both master points see the upstream bus delay; its fader is downstream of bus FX.
                    self.assertFalse(outputs['pre'][:9].any());self.assertFalse(outputs['post'][:9].any())

    def test_muted_source_is_neutral_and_post_channel_is_pre_fader(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'input.wav'
            with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(signal())
            p=self.project();p['tracks']['main']['muted']=True;p['video']['reactiveAnalysis']=dict(source='t:main',point='post')
            self.assertFalse(unpack(analyze_reactive_project(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda d,_:d)).any())
            p['tracks']['main'].update(muted=False,volume=0)
            self.assertGreater(unpack(analyze_reactive_project(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda d,_:d)).max(),200)

    def test_all_preset_contracts_and_source_validation(self):
        for preset in SCHEMA['creativeReactivePresets']:
            p=self.project();p['video']['reactiveFx']=validate_creative_reactive_fx(dict(preset=preset['id']))
            self.assertEqual(validate_project(p),p)
            if 6<=int(preset['id'][4:])<=15:
                curves={key:[[0,spec['min']],[1,spec['max']]] for key,spec in preset['parameters'].items() if spec.get('automatable',True)}
                effect=validate_creative_reactive_fx(dict(preset=preset['id'],automation=curves));self.assertEqual(effect['automation'],curves)
                for key,spec in preset['parameters'].items():
                    if not spec.get('automatable',True):
                        with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset=preset['id'],automation={key:[[0,spec['default']]]}))
                    if spec.get('integer'):
                        with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset=preset['id'],parameters={key:spec['default']+.5}))
        for source in ('../main','t:missing','b:missing','https://example.com'):
            p=self.project();p['video']['reactiveAnalysis']['source']=source
            with self.subTest(source=source),self.assertRaises(ValueError):validate_project(p)
        with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset='ARX-01',parameters=dict(bandLow=1000,bandHigh=100)))

    def test_api_preparation_validation_busy_and_cancel_before_start(self):
        app=Flask(__name__);slot=threading.Semaphore(1);app.register_blueprint(create_reactive_api(engine._ffmpeg_bin,slot,lambda data,_:data));client=app.test_client()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'input.wav'
            with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(signal())
            def request(identifier=None,project=None):
                return client.post('/api/audio/reactive',data=dict(id=identifier or str(uuid.uuid4()),project=json.dumps(project or self.project()),main=(io.BytesIO(path.read_bytes()),'tone.wav')))
            response=request();self.assertEqual(response.status_code,200);self.assertGreater(unpack(response.json).max(),200)
            bad=self.project();bad['video']['reactiveAnalysis']['source']='t:missing';self.assertEqual(request(project=bad).status_code,400)
            slot.acquire();self.assertEqual(request().status_code,429);slot.release()
            identifier=str(uuid.uuid4());self.assertEqual(client.delete('/api/audio/reactive/'+identifier).status_code,200);self.assertEqual(request(identifier).status_code,409)
            self.assertTrue(slot.acquire(blocking=False));slot.release()
            self.assertEqual(client.delete('/api/audio/reactive/not-a-uuid').status_code,400)
