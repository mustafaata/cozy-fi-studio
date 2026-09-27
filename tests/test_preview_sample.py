import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
from pedalboard.io import AudioFile
import app
import engine
from project import TRACK_IDS,validate_project
from sample_api import sample_bounds


class SampleTests(unittest.TestCase):
    def project(self):
        p=validate_project(dict(version=1,tracks={k:{} for k in TRACK_IDS}))
        p['tracks']['main']['source']=dict(name='song.wav',size=4,lastModified=0,duration=20)
        p['effects'].update(speed=1,reverb=20)
        return p

    def test_bounds_are_frame_aligned_and_bounded(self):
        p=self.project();p['output']['fps']='24'
        start,end=sample_bounds(p,.02,5)
        self.assertEqual(start,0);self.assertEqual(end,5)
        for a,b in [(0,4),(0,16),(16,5),(-1,5),(float('nan'),5),(0,float('inf'))]:
            with self.assertRaises(ValueError):sample_bounds(p,a,b)

    def test_late_sample_matches_full_timeline_fades_lyrics_and_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);ffmpeg=engine._ffmpeg_bin();audio=root/'song.wav';video=root/'video.mp4'
            sr=44100;t=np.arange(sr*20)/sr
            with AudioFile(str(audio),'w',sr,2) as f:f.write(np.stack([.1*np.sin(2*np.pi*440*t)]*2).astype(np.float32))
            subprocess.run([ffmpeg,'-y','-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=8:duration=2',
                            '-c:v','libx264',str(video)],check=True)
            p=self.project();p['tracks']['main']['source']['size']=audio.stat().st_size
            p['tracks']['main'].update(fadeIn=10,fadeOut=8)
            p['video'].update(start=.25,end=1.75,speed=.5,fadeIn=10,fadeOut=8)
            p['output'].update(fps='60',interpolation='motion',resolution='source')
            p['lyrics'].update(fontSize=60,lines=[dict(id='one',text='Test',start=9,end=10)])
            files={'main':str(audio),'background':str(video)}
            full=root/'full.mp4';sample=root/'sample.mp4'
            for dest,window in [(full,None),(sample,(8,14))]:
                ok,message=engine.process_and_render(p,files,str(dest),sample_range=window)
                self.assertTrue(ok,message)
            def frames(path,start=0):
                r=subprocess.run([ffmpeg,'-v','error','-i',str(path),'-ss',str(start),'-t','6','-an',
                    '-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True)
                return np.frombuffer(r.stdout,np.uint8).reshape(-1,64,96,3).astype(float)
            a,b=frames(full,8),frames(sample)
            self.assertEqual(len(b),360);self.assertEqual(a.shape,b.shape)
            self.assertLess(np.abs(a-b).mean(),4) # CRF prediction restarts at the sample boundary.
            def pcm(path,start):
                r=subprocess.run([ffmpeg,'-v','error','-i',str(path),'-ss',str(start),'-t','6','-vn','-ac','1',
                    '-ar','16000','-f','f32le','-'],capture_output=True,check=True)
                return np.frombuffer(r.stdout,np.float32)
            x,y=pcm(full,8),pcm(sample,0);n=min(len(x),len(y))
            self.assertAlmostEqual(len(y)/16000,6,delta=.03)
            self.assertGreater(np.corrcoef(x[2048:n-2048],y[2048:n-2048])[0,1],.98)
            self.assertFalse(Path(str(sample)+'.partial.mp4').exists())

    def test_endpoint_shared_slot_cancel_and_no_published_output(self):
        client=app.app.test_client();p=self.project()
        def payload():return {'project':json.dumps(p),'start':'2','length':'5','main':(io.BytesIO(b'abcd'),'song.wav')}
        with patch('sample_api.media_assets.source_path',return_value='video.mp4'):
            app.RENDER_SLOT.acquire()
            try:self.assertEqual(client.post('/api/preview-samples',data=payload()).status_code,429)
            finally:app.RENDER_SLOT.release()
            started=threading.Event();paths=[]
            def render(project,files,dest,work,report,cancel,sample_range):
                paths.append(dest);started.set()
                cancel.wait(3)
                return False,'cancelled'
            with patch('sample_api.engine.process_and_render',side_effect=render):
                response=client.post('/api/preview-samples',data=payload());self.assertEqual(response.status_code,202)
                token=response.json['job_id'];self.assertTrue(started.wait(2))
                self.assertFalse(Path(paths[0]).is_relative_to(Path(app.OUTPUT_DIR)))
                self.assertEqual(client.post('/api/preview-samples/'+token+'/cancel').json['state'],'cancelling')
                deadline=time.monotonic()+5
                while time.monotonic()<deadline:
                    result=client.get('/api/preview-samples/'+token).json
                    if result['state']=='cancelled':break
                    time.sleep(.01)
                self.assertEqual(result['state'],'cancelled')
                self.assertEqual(client.get('/api/preview-samples/'+token+'/video').status_code,404)
                client.delete('/api/preview-samples/'+token)
                self.assertEqual(client.get('/api/preview-samples/'+token).status_code,404)


if __name__=='__main__':unittest.main()
