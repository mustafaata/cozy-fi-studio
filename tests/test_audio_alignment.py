import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from scipy.io import wavfile
import app
import engine
import media_assets
from audio_alignment import correlation_offset, decode_camera
from project import validate_project
from project_package import build_package, unpack_package


class AlignmentTests(unittest.TestCase):
    def test_authored_camera_cuts_reach_mp4_in_correct_order_without_changing_audio(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);assets=[];main=root/'main.wav'
            wavfile.write(main,44100,(np.sin(np.arange(88200)*2*np.pi*220/44100)*6000).astype(np.int16))
            for color in ['red','blue']:
                path=root/f'{color}.mp4'
                subprocess.run([engine._ffmpeg_bin(),'-v','error','-f','lavfi','-i',f'color=c={color}:s=64x64:r=24:d=2',
                    '-c:v','libx264','-threads','2',str(path)],check=True)
                assets.append(media_assets.prepare_asset(path,path.name,engine._ffmpeg_bin()))
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=2),end=2,loop=False)),
                multicam=dict(end=1.5),cameraAngles=[dict(id=f'cam{i}',asset=info['asset']) for i,info in enumerate(assets)],
                cameraCuts=[dict(time=time,angle=angle) for time,angle in [(0,'cam0'),(.5,'cam1'),(1,'cam0')]],output=dict(resolution='source')))
            script="""const fs=require('fs'),vm=require('vm');const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
              vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',c);
              for(const name of ['project','video-time','scene-renderer','parameter-curves','editing','multicam'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);
              c.raw=JSON.parse(fs.readFileSync(0,'utf8'));vm.runInContext('const p=validateProject(raw.project);applyCameraCuts(p,new Map(raw.infos.map(i=>[i.asset,i])));',c);
              process.stdout.write(vm.runInContext('JSON.stringify(p)',c));"""
            result=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,infos=assets)),cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr);authored=validate_project(json.loads(result.stdout))
            self.assertEqual(authored['tracks'],p['tracks'])
            paths=[str(media_assets.source_path(a['asset'])) for a in assets];output=root/'multicam.mp4'
            ok,message=engine.process_and_render(authored,dict(main=str(main),background=paths[0],clip_paths=[paths[0],paths[1],paths[0]]),str(output))
            self.assertTrue(ok,message)
            for time,channel in [(.25,0),(.75,2),(1.25,0)]:
                frame=subprocess.run([engine._ffmpeg_bin(),'-v','error','-ss',str(time),'-i',str(output),'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],capture_output=True,check=True)
                rgb=np.frombuffer(frame.stdout,dtype=np.uint8);self.assertGreater(rgb[channel],180);self.assertLess(rgb[2-channel],40)
            decoded=subprocess.run([engine._ffmpeg_bin(),'-v','error','-i',str(output),'-vn','-ac','1','-ar','44100','-f','f32le','pipe:1'],capture_output=True,check=True)
            samples=np.frombuffer(decoded.stdout,dtype='<f4');self.assertGreater(np.sqrt(np.mean(samples[int(.6*44100):int(1.4*44100)]**2)),.1)

    def test_noise_alignment_has_correct_sign_for_both_recording_origins(self):
        rng=np.random.default_rng(25);source=rng.normal(0,.1,40000)
        for lag in [-2400,2400]:
            target=np.r_[np.zeros(lag),source[:-lag]] if lag>0 else np.r_[source[-lag:],np.zeros(-lag)]
            result=correlation_offset(source,target)
            self.assertAlmostEqual(result['offset'],lag/8000,delta=1/8000);self.assertGreater(result['confidence'],.99)

    def test_silence_periodic_ambiguous_and_missing_overlap_are_visible_errors(self):
        for x,y in [(np.zeros(16000),np.zeros(16000)),(np.ones(10),np.ones(10)),
                (np.sin(np.arange(24000)*2*np.pi*440/8000),np.sin(np.arange(24000)*2*np.pi*440/8000))]:
            with self.assertRaises(ValueError):correlation_offset(x,y)

    def test_real_encoded_delayed_camera_audio_api_and_package_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);source=np.random.default_rng(33).normal(0,.1,24000).astype(np.float32)
            wavfile.write(root/'noise.wav',8000,source);assets=[]
            for i,delay in enumerate([0,.3]):
                path=root/f'camera{i}.mp4'
                subprocess.run([engine._ffmpeg_bin(),'-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=3',
                    '-itsoffset',str(delay),'-i',str(root/'noise.wav'),'-t','3','-c:v','libx264','-c:a','aac',str(path)],check=True)
                assets.append(media_assets.prepare_asset(path,path.name,engine._ffmpeg_bin()))
            reference,target=[decode_camera(info['asset'],engine._ffmpeg_bin()) for info in assets]
            self.assertAlmostEqual(correlation_offset(reference,target)['offset'],.3,delta=.002)
            client=app.app.test_client();body=dict(reference=assets[0]['asset'],target=assets[1]['asset'])
            response=client.post('/api/media/align-audio',json=body);self.assertEqual(response.status_code,200)
            self.assertAlmostEqual(response.json['offset'],.3,delta=.002)
            for bad in [None,{},dict(body,path='../secret'),dict(body,target='../private')]:
                self.assertEqual(client.post('/api/media/align-audio',json=bad).status_code,400)
            app.MEDIA_SLOT.acquire()
            try:self.assertEqual(client.post('/api/media/align-audio',json=body).status_code,429)
            finally:app.MEDIA_SLOT.release()
            p=validate_project(dict(version=1,tracks=dict(main={}),cameraAngles=[dict(id=f'cam{i}',asset=info['asset'],offset=i*.3) for i,info in enumerate(assets)],cameraCuts=[dict(time=0,angle='cam0')]))
            archive=io.BytesIO();files={f'media/camera_{i:03d}':media_assets.source_path(info['asset']) for i,info in enumerate(assets)}
            build_package(archive,p,files);archive.seek(0);(root/'opened').mkdir();unpacked,_=unpack_package(archive,root/'opened')
            self.assertEqual(unpacked,p)
            invalid=json.loads(json.dumps(p));invalid['cameraCuts'][0]['angle']='missing'
            with self.assertRaises(ValueError):validate_project(invalid)
