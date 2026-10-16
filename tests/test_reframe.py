import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile
import engine
import media_assets
from project import validate_project
from project_package import build_package, unpack_package


class ReframeTests(unittest.TestCase):
    def test_variant_contract_and_package_keep_independent_geometry(self):
        p=validate_project(dict(version=1,tracks=dict(main={}),reframeVariants=[dict(id='square',name='Kare',output=dict(aspect='1:1'),geometry=dict(keyframes=dict(translateX=[[0,20],[1,-20]])))]))
        self.assertEqual(validate_project(p),p);self.assertEqual(p['video']['keyframes'],{})
        for update in [dict(id='../bad'),dict(name=' '),dict(output=dict(aspect='4:3')),dict(geometry=dict(cropLeft=96)),dict(geometry=dict(keyframes=dict(opacity=[[0,50]]))),dict(geometry=dict(motionPath=None))]:
            q=copy.deepcopy(p);q['reframeVariants'][0].update(update)
            with self.assertRaises(ValueError):validate_project(q)
        with tempfile.TemporaryDirectory() as folder:
            archive=io.BytesIO();build_package(archive,p,{});archive.seek(0);opened,_=unpack_package(archive,folder);self.assertEqual(opened,p)

    def test_generated_three_aspects_keep_subject_in_real_mp4(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);video=root/'moving.mp4';main=root/'main.wav';ffmpeg=engine._ffmpeg_bin();frames=np.zeros((24,108,192,3),dtype=np.uint8);frames[:,:,:,2]=255
            for i,frame in enumerate(frames):frame[42:66,48+3*i:72+3*i]=[255,0,0]
            subprocess.run([ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','192x108','-r','24','-i','pipe:0','-c:v','libx264','-crf','0','-pix_fmt','yuv420p','-threads','2',str(video)],input=frames.tobytes(),check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg);wavfile.write(main,44100,np.zeros(44100,dtype=np.int16))
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),video=dict(linkSpeed=False),videoClips=[dict(id='v',asset=info['asset'],start=0,end=1,offset=0)]))
            script='''const fs=require('node:fs'),vm=require('node:vm'),input=JSON.parse(fs.readFileSync(0,'utf8'));
              const c=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},input});
              for(const n of ['project','parameter-curves','motion-path','video-keyframes','video-time','frame-renderer','scene-renderer','perspective','editing','motion-tracking','reframe'])vm.runInContext(fs.readFileSync('static/js/'+n+'.js','utf8'),c);
              process.stdout.write(vm.runInContext(`JSON.stringify(['16:9','1:1','9:16'].map(aspect=>{const p=validateProject(input.project),entry=clipTimeline(p,[input.info])[0],variant=generateReframeVariant(p,entry,[[0,31.25,50,1],[1,68.75,50,1]],aspect,{smoothing:0}).variant;p.reframeVariants.push(variant);applyReframeVariant(p,variant);return p;}))`,c));'''
            result=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,info=info)),capture_output=True,text=True,check=True);projects=json.loads(result.stdout)
            for project,(width,height) in zip(projects,[(192,108),(108,108),(108,192)]):
                target=root/f'{width}_{height}.mp4';ok,message=engine.process_and_render(validate_project(project),dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
                raw=subprocess.run([ffmpeg,'-v','error','-ss','0.25','-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(height,width,3)
                y,x=np.where((frame[:,:,0]>180)&(frame[:,:,1]<50)&(frame[:,:,2]<50));self.assertGreater(len(x),300)
                self.assertAlmostEqual(x.mean(),77.5 if width==192 else width/2-.5,delta=1.5);self.assertAlmostEqual(y.mean(),height/2-.5,delta=1.5)
                for yy,xx in [(2,2),(2,width-3),(height-3,2),(height-3,width-3)]:self.assertGreater(frame[yy,xx,2],200)
