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
from pedalboard.io import AudioFile
import engine
import media_assets
from project import validate_project
from project_package import build_package,unpack_package


class SequenceTests(unittest.TestCase):
    def project(self):
        source=dict(name='source.wav',size=1,lastModified=0,duration=10)
        return validate_project(dict(version=1,effects=dict(speed=1),video=dict(linkSpeed=False),tracks=dict(main=dict(source=source),rain=dict(source=source,offset=1,end=2,until=3,loop=False)),videoClips=[dict(id='video',asset='a'*64,start=0,end=2,offset=1,transitionDuration=0)],visualLayers=[dict(id='text',type='text',text='Sekans',offset=1,until=3)],sequences=[dict(id='inner',offset=1,duration=2,members=[['audio','rain'],['video','video'],['visual','text']]),dict(id='outer',offset=1,duration=2,members=[['sequence','inner']])]))

    def test_shared_contract_ownership_cycles_bounds_ramps_and_package(self):
        p=self.project();self.assertEqual(validate_project(p),p)
        self.assertEqual(validate_project(json.loads(json.dumps(p))),p)
        for action in [lambda q:q['sequences'][0]['members'].append(['audio','rain']),lambda q:q['sequences'][0]['members'].append(['sequence','outer']),lambda q:q['sequences'][0].update(duration=.1),lambda q:q['sequences'][0].update(offset=10),lambda q:q['sequences'][0].update(members=[['audio','missing']]),lambda q:q['sequences'][0].update(members=[['audio','main']]),lambda q:q['sequences'][0].update(locked=1),lambda q:q['sequences'][0].update(surprise=True),lambda q:q.update(sequences=None)]:
            q=copy.deepcopy(p);action(q)
            with self.subTest(q=q['sequences']),self.assertRaises(ValueError):validate_project(q)
        q=copy.deepcopy(p);q['videoClips'][0]['timeRemap']['ramp']=[[0,.5,'smooth'],[2,2,'linear']]
        with self.assertRaises(ValueError):validate_project(q)
        q['sequences'][0]['duration']=q['sequences'][1]['duration']=2.5;self.assertEqual(validate_project(q)['sequences'][0]['duration'],2.5)
        q=copy.deepcopy(p)
        for i in range(3):q['sequences'].append(dict(id='deep'+str(i),offset=1,duration=2,members=[['sequence','outer' if i==0 else 'deep'+str(i-1)]]))
        with self.assertRaises(ValueError):validate_project(q)

    def test_browser_authored_nested_move_survives_package_and_real_audio_video_export(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);ffmpeg=engine._ffmpeg_bin();main=root/'main.wav';rain=root/'rain.wav';video=root/'red.mp4'
            wavfile.write(main,44100,np.zeros((110250,2),np.float32));tone=np.stack([.1*np.sin(2*np.pi*440*np.arange(44100)/44100)]*2).astype(np.float32);wavfile.write(rain,44100,tone.T)
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=red:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            source=lambda path,duration:dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=duration)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0,isVinyl=False),master=dict(ceiling=0),tracks=dict(main=dict(source=source(main,2.5),loop=False,fadeIn=0,fadeOut=0),rain=dict(source=source(rain,1),offset=.5,until=1.5,loop=False,fadeIn=0,fadeOut=0)),background=dict(asset=info['asset']),video=dict(linkSpeed=False,loop=False),videoClips=[dict(id='video',asset=info['asset'],offset=.5,start=0,end=1,transitionDuration=0)],visualLayers=[dict(id='shape',type='shape',offset=.5,until=1.5,width=40,shape=dict(fillColor='#00ff00',strokeWidth=0)),dict(id='text',type='text',text='Sekans',offset=.5,until=1.5,y=10,fontSize=8)]))
            script="""const fs=require('fs'),vm=require('vm'),v=JSON.parse(fs.readFileSync(0,'utf8'));const c=vm.createContext({Event,EventTarget,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},v});for(const name of ['project','parameter-curves','editing','main-editing','video-time','scene-renderer','visual-layers','sequences'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);process.stdout.write(vm.runInContext(`(()=>{const p=validateProject(v.p),infos=new Map([[v.info.asset,v.info]]);createSequence(p,infos,[['audio','rain'],['video','video'],['visual','shape'],['visual','text']],'Inner','inner');createSequence(p,infos,[['sequence','inner']],'Outer','outer');moveSequence(p,'outer',.75);return JSON.stringify(validateProject(p));})()`,c));"""
            script=script.replace("for(const name of", "vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',c);for(const name of")
            result=subprocess.run(['node','-e',script],input=json.dumps(dict(p=p,info=info)),text=True,capture_output=True);self.assertEqual(result.returncode,0,result.stderr);p=validate_project(json.loads(result.stdout))
            archive=io.BytesIO();build_package(archive,p,{'media/main':str(main),'media/rain':str(rain),'media/video':str(media_assets.source_path(info['asset'])),'media/clip_000':str(media_assets.source_path(info['asset']))});archive.seek(0);(root/'opened').mkdir();opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,p)
            target=root/'sequence.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),rain=str(rain),background=str(media_assets.source_path(info['asset'])),clip_paths=[str(media_assets.source_path(info['asset']))]),str(target));self.assertTrue(ok,message)
            decoded=root/'output.wav';subprocess.run([ffmpeg,'-v','error','-i',str(target),'-vn','-c:a','pcm_f32le',str(decoded)],check=True)
            with AudioFile(str(decoded)) as handle:audio=handle.read(handle.frames)
            self.assertLess(float(np.max(np.abs(audio[:,:round(.7*44100)]))),.003);self.assertGreater(float(np.sqrt(np.mean(audio[:,round(.8*44100):round(1.6*44100)]**2))),.06);self.assertLess(float(np.max(np.abs(audio[:,round(1.85*44100):]))),.003)
            for time in [.25,1,2]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(64,96,3)
                if time==1:self.assertGreater(int(frame[32,48,1]),180);self.assertGreater(int(frame[40,5,0]),180)
                else:self.assertLess(int(frame.max()),20)

    def test_reused_definition_edits_survive_server_validation_package_and_two_audio_placements(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);main=root/'main.wav';rain=root/'rain.wav';wavfile.write(main,44100,np.zeros((441000,2),np.float32));tone=np.stack([.1*np.sin(2*np.pi*440*np.arange(88200)/44100)]*2).astype(np.float32);wavfile.write(rain,44100,tone.T)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=10),loop=False,fadeIn=0,fadeOut=0),rain=dict(source=dict(name=rain.name,size=rain.stat().st_size,lastModified=0,duration=2),offset=1,until=3,loop=False,fadeIn=0,fadeOut=0)),visualLayers=[dict(id='text',type='text',name='Shared',text='Before',offset=1,until=3)]))
            script="""const fs=require('fs'),vm=require('vm'),v=JSON.parse(fs.readFileSync(0,'utf8'));const c=vm.createContext({Event,EventTarget,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})},v});vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',c);for(const name of ['project','parameter-curves','editing','main-editing','video-time','scene-renderer','visual-layers','sequences','sequence-instances'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);process.stdout.write(vm.runInContext(`(()=>{const p=validateProject(v);createSequence(p,new Map(),[['audio','rain'],['visual','text']],'Shared','shared');const use=createSequenceInstance(p,'shared',5);projectStore.replace(p);projectStore.addConstraint(sequenceConstraints);projectStore.update(p=>{p.tracks.rain.volume=50;p.visualLayers[0].text='After';});return JSON.stringify({project:projectStore.snapshot(),use});})()`,c));"""
            result=subprocess.run(['node','-e',script],input=json.dumps(p),text=True,capture_output=True);self.assertEqual(result.returncode,0,result.stderr);result=json.loads(result.stdout);p=validate_project(result['project']);use=result['use'];copied=use['audio'][0]['id'];self.assertEqual(p['tracks'][copied]['volume'],50);self.assertEqual(p['visualLayers'][1]['text'],'After')
            bad=copy.deepcopy(p);bad['tracks'][copied]['volume']=100
            with self.assertRaises(ValueError):validate_project(bad)
            files=dict(main=str(main),rain=str(rain));files[copied]=str(rain)
            archive=io.BytesIO();build_package(archive,p,{'media/'+k:v for k,v in files.items()});archive.seek(0);(root/'opened').mkdir();opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,p)
            from audio_render import render_project_audio
            output=render_project_audio(p,files,folder,engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(output) as handle:audio=handle.read(handle.frames)
            for start in [1,5]:np.testing.assert_allclose(audio[:,round(start*44100):round((start+2)*44100)],tone*.5,atol=2e-7)
            self.assertLess(float(np.max(np.abs(audio[:,round(3.1*44100):round(4.9*44100)]))),1e-7)
