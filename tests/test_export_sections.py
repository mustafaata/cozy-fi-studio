import copy
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
from scipy.io import wavfile
import app
import engine
import media_assets
from export_sections import section_render
from project import validate_project


class ExportSectionTests(unittest.TestCase):
    def project(self):
        return validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name='main.wav',size=4,lastModified=0,duration=3),end=3)),effects=dict(speed=1,reverb=0),
            exportSections=[dict(id='section_one',name='Giriş',filename='giris',start=.5,end=1.5,output=dict(fps='24',resolution='source'))]))

    def test_contract_rejects_unsafe_names_types_duplicates_and_bad_outputs(self):
        p=self.project();self.assertEqual(validate_project(p),p)
        for key,value in [('id','../private'),('filename','../movie'),('filename','NUL'),('name',' '),('start',True),('end',.51),('output',dict(fps='120'))]:
            q=copy.deepcopy(p);q['exportSections'][0][key]=value
            if key=='end':
                with self.assertRaises(ValueError):section_render(validate_project(q),'section_one')
            else:
                with self.assertRaises(ValueError):validate_project(q)
        p['exportSections']*=2
        with self.assertRaises(ValueError):validate_project(p)

    def test_resolver_preserves_all_authored_clocks_and_rejects_unavailable_ranges_before_slot(self):
        p=self.project();before=copy.deepcopy(p);p['exportSections'][0]['output']['fps']='60'
        prepared,window,name=section_render(p,'section_one');self.assertEqual(window,(.5,1.5));self.assertEqual(name,'giris');self.assertEqual(prepared['output']['fps'],'60')
        for key in ['tracks','video','lyrics','videoClips']:self.assertEqual(prepared[key],before[key])
        self.assertEqual(p['output']['fps'],'24')
        client=app.app.test_client()
        for section_id in ['missing','../private','']:
            with patch.object(app,'RENDER_SLOT') as slot:
                self.assertEqual(client.post('/render',data=dict(project=json.dumps(p),sectionId=section_id)).status_code,400);slot.acquire.assert_not_called()
        p['exportSections'][0]['end']=4
        with self.assertRaises(ValueError):section_render(p,'section_one')

    def test_render_endpoint_queues_range_settings_and_named_download_and_releases_slot(self):
        p=self.project();p['background']['asset']='a'*64;finished=threading.Event();calls=[];client=app.app.test_client()
        with tempfile.TemporaryDirectory() as folder,patch.object(app,'OUTPUT_DIR',folder),patch('app.media_assets.source_path',return_value='video.mp4'):
            def render(project,files,destination,**options):
                calls.append((project,options));Path(destination).write_bytes(b'test-mp4');finished.set();return True,'OK'
            with patch('app.engine.process_and_render',side_effect=render):
                response=client.post('/render',data=dict(project=json.dumps(p),sectionId='section_one',main_file=(io.BytesIO(b'wave'),'main.wav')))
                self.assertEqual(response.status_code,200);self.assertTrue(finished.wait(2));job_id=response.json['job_id']
                for _ in range(100):
                    job=client.get('/status/'+job_id).json
                    if job['state']=='done':break
                    time.sleep(.01)
                self.assertEqual(job['state'],'done');self.assertEqual(calls[0][1]['sample_range'],(.5,1.5));self.assertEqual(calls[0][0]['output'],p['exportSections'][0]['output'])
                output=client.get(job['download_url']);self.assertEqual(output.data,b'test-mp4');self.assertIn('giris.mp4',output.headers['Content-Disposition']);output.close()
                self.assertEqual(client.get('/api/render/missing/file').status_code,404)
                self.assertTrue(app.RENDER_SLOT.acquire(blocking=False));app.RENDER_SLOT.release()

    def test_real_section_mp4_matches_full_project_video_and_automated_audio_at_original_time(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'source.mp4';ffmpeg=engine._ffmpeg_bin()
            wavfile.write(main,44100,(np.sin(np.arange(132300)*2*np.pi*330/44100)*6000).astype(np.int16))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','testsrc2=s=96x64:r=24:d=3','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg);p=self.project();p['tracks']['main']['source']['size']=main.stat().st_size
            p['tracks']['main']['automation']={'volume':[[0,20],[3,180]]};p['video']['keyframes']={'opacity':[[0,25],[3,100]]};p['background']['asset']=info['asset']
            prepared,window,_=section_render(p,'section_one');files=dict(main=str(main),background=str(media_assets.source_path(info['asset'])))
            paths=[root/'full.mp4',root/'section.mp4']
            for project,target,window in [(p,paths[0],None),(prepared,paths[1],window)]:
                ok,message=engine.process_and_render(project,files,str(target),sample_range=window);self.assertTrue(ok,message)
            frames=[];audio=[]
            for path,start in zip(paths,[.5,0]):
                result=subprocess.run([ffmpeg,'-v','error','-i',str(path),'-ss',str(start),'-t','1','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                frames.append(np.frombuffer(result.stdout,dtype=np.uint8).reshape(-1,64,96,3).astype(float))
                result=subprocess.run([ffmpeg,'-v','error','-i',str(path),'-ss',str(start),'-t','1','-vn','-ac','1','-ar','44100','-f','f32le','pipe:1'],capture_output=True,check=True)
                audio.append(np.frombuffer(result.stdout,dtype='<f4'))
            self.assertEqual(frames[1].shape,(24,64,96,3));self.assertLess(np.abs(frames[0]-frames[1]).mean(),4)
            n=min(map(len,audio));self.assertAlmostEqual(len(audio[1])/44100,1,delta=.03);self.assertLess(np.sqrt(np.mean((audio[0][2048:n-2048]-audio[1][2048:n-2048])**2)),.01)
