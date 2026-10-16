import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

import numpy as np
from scipy.io import wavfile

import app
import engine
import media_assets
from project import validate_project
from video_audio import SourceClock, audio_file, extraction_plan, prepare_audio


class VideoAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary=tempfile.TemporaryDirectory(prefix='video-audio-')
        cls.root=Path(cls.temporary.name);cls.ffmpeg=engine._ffmpeg_bin()
        cls.assets=patch.object(media_assets,'ASSET_DIR',cls.root/'assets');cls.assets.start()
        video=cls.root/'sesli-video.mp4'
        subprocess.run([cls.ffmpeg,'-v','error','-f','lavfi','-i','color=c=0x526c79:s=64x64:r=24:d=2',
            '-f','lavfi','-i','aevalsrc=0.25*sin(2*PI*(220*t+55*t*t)):s=44100:d=2',
            '-c:v','libx264','-c:a','aac','-shortest',str(video)],check=True)
        cls.info=media_assets.prepare_asset(video,video.name,cls.ffmpeg)
        silent=cls.root/'silent.mp4'
        subprocess.run([cls.ffmpeg,'-v','error','-i',str(video),'-an','-c:v','copy',str(silent)],check=True)
        cls.silent=media_assets.prepare_asset(silent,silent.name,cls.ffmpeg)

    @classmethod
    def tearDownClass(cls):
        cls.assets.stop();cls.temporary.cleanup()

    def project(self):
        return validate_project(dict(version=1,tracks=dict(main={}),effects=dict(speed=1),video=dict(linkSpeed=False),
            videoClips=[dict(id='one',asset=self.info['asset'],offset=.25,start=.25,end=1.25,transitionDuration=0)]))

    def test_source_clock_matches_browser_for_curves_reverse_rates_and_partial_intervals(self):
        root=Path(__file__).resolve().parents[1]
        inputs=[]
        for curve in ['linear','smooth','hold']:
            for reverse in [False,True]:
                for rate in [.25,1,2.5]:
                    p=self.project();clip=p['videoClips'][0];clip['timeRemap'].update(reverse=reverse,ramp=[[0,.75,curve],[1,2,'smooth'],[2,1,'hold']])
                    clock=SourceClock(clip,2,rate);times=np.linspace(0,clock.duration,49)
                    inputs.append(dict(clip=clip,rate=rate,times=times.tolist(),expected=clock.positions(times).tolist(),duration=clock.duration))
        script="""const fs=require('fs'),vm=require('vm');const project=fs.readFileSync('static/js/project.js','utf8');vm.runInThisContext(project.slice(project.indexOf('function videoPaceIntegral'),project.indexOf('function projectFields')));vm.runInThisContext(fs.readFileSync('static/js/video-time.js','utf8'));
          const inputs=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(inputs.map(i=>{const m=videoTimeMap(i.clip,{duration:2,fps:24},i.rate);return {duration:m.duration,positions:i.times.map(t=>m.sourceAt(t))};})));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(inputs),cwd=root,capture_output=True,text=True,check=True)
        for entry,actual in zip(inputs,json.loads(result.stdout)):
            self.assertAlmostEqual(entry['duration'],actual['duration'],places=10)
            np.testing.assert_allclose(entry['expected'],actual['positions'],atol=2e-10)

    def test_real_audio_trim_reverse_and_cache_are_sample_aligned(self):
        p=self.project();forward=extraction_plan(p,'one');metadata=prepare_audio(forward,self.ffmpeg)
        rate,a=wavfile.read(audio_file(self.info['asset'],forward['digest']))
        self.assertEqual(rate,44100);self.assertEqual(a.shape,(44100,2));self.assertGreater(np.max(np.abs(a)),1000)
        p['videoClips'][0]['timeRemap']['reverse']=True
        reverse=extraction_plan(p,'one');prepare_audio(reverse,self.ffmpeg)
        _,b=wavfile.read(audio_file(self.info['asset'],reverse['digest']))
        np.testing.assert_allclose(a[::-1],b,atol=1)
        p['videoClips'][0]['offset']=1;p['videoClips'][0]['name']='renamed';p['videoClips'][0]['color']['exposure']=1
        self.assertEqual(extraction_plan(p,'one')['digest'],reverse['digest'])
        with patch('video_audio.subprocess.run',side_effect=AssertionError('cache should not decode')):
            self.assertEqual(prepare_audio(forward,self.ffmpeg),metadata)

    def test_ramp_speed_and_frozen_audio_have_quantized_video_duration(self):
        for remap in [dict(ramp=[[0,.75,'smooth'],[2,2,'hold']]),dict(freezeAt=.5,freezeDuration=.613)]:
            p=self.project();p['videoClips'][0]['timeRemap'].update(remap);p['videoClips'][0]['speed']=1.25;p['output']['fps']='60'
            plan=extraction_plan(p,'one');metadata=prepare_audio(plan,self.ffmpeg)
            with wave.open(str(audio_file(self.info['asset'],plan['digest']))) as audio:
                self.assertAlmostEqual(audio.getnframes()/audio.getframerate(),plan['span'],delta=1/44100)
                raw=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2')
            self.assertEqual(bool(np.max(np.abs(raw))),remap.get('freezeAt') is None)
            self.assertAlmostEqual(metadata['source']['duration'],plan['span'],delta=1/44100)

    def test_delayed_audio_keeps_video_origin_with_initial_silence(self):
        path=self.root/'delayed.mp4'
        subprocess.run([self.ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=24:d=2',
            '-itsoffset','0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=1',
            '-c:v','libx264','-c:a','aac',str(path)],check=True)
        info=media_assets.prepare_asset(path,path.name,self.ffmpeg)
        p=self.project();p['videoClips'][0].update(asset=info['asset'],start=0,end=2)
        plan=extraction_plan(p,'one');prepare_audio(plan,self.ffmpeg)
        _,audio=wavfile.read(audio_file(info['asset'],plan['digest']))
        self.assertLess(np.max(np.abs(audio[:int(.4*44100)])),10)
        self.assertGreater(np.max(np.abs(audio[int(.6*44100):int(.9*44100)])),500)

    def test_source_handles_preserve_cut_clock_for_reverse_speed_and_ramps(self):
        for reverse,ramp,rate in [(False,[],1),(True,[],1),(False,[[0,.75,'smooth'],[2,2,'hold']],1.25),
                (True,[[0,.75,'linear'],[2,2,'hold']],.5)]:
            p=self.project();clip=p['videoClips'][0];clip['speed']=rate;clip['timeRemap'].update(reverse=reverse,ramp=ramp)
            cut=extraction_plan(p,'one');full=extraction_plan(p,'one',True)
            metadata=prepare_audio(full,self.ffmpeg)
            self.assertAlmostEqual(metadata['audioAnchor'],full['anchor'])
            times=np.linspace(0,cut['clock'].duration,41)
            np.testing.assert_allclose(full['clock'].positions(times+full['anchor']),cut['clock'].positions(times),atol=2e-10)
            prepare_audio(cut,self.ffmpeg)
            _,a=wavfile.read(audio_file(self.info['asset'],cut['digest']))
            _,b=wavfile.read(audio_file(self.info['asset'],full['digest']))
            positions=full['anchor']*44100+np.arange(min(len(a),int(cut['clock'].duration*44100)-2))
            actual=np.interp(positions,np.arange(len(b)),b[:,0])
            self.assertLess(np.sqrt(np.mean((actual-a[:len(positions),0])**2)),15)
            self.assertGreater(full['anchor'],0)
            self.assertGreater(metadata['source']['duration'],full['anchor']+cut['clock'].duration)

    def test_handle_cache_reuses_bytes_but_each_cut_has_its_own_anchor(self):
        p=self.project();first=extraction_plan(p,'one',True);prepare_audio(first,self.ffmpeg)
        p['videoClips'][0].update(start=.5,end=1.5)
        second=extraction_plan(p,'one',True)
        self.assertEqual(first['digest'],second['digest']);self.assertEqual(second['anchor'],.5)
        with patch('video_audio.subprocess.run',side_effect=AssertionError('cache should not decode')):
            self.assertEqual(prepare_audio(second,self.ffmpeg)['audioAnchor'],.5)

    def test_handle_api_rejects_invalid_options_and_freeze_and_validates_saved_anchor(self):
        p=self.project();client=app.app.test_client()
        for bad in [None,0,1,'true',{},[]]:
            self.assertEqual(client.post('/api/media/extract-audio',json=dict(project=p,clipId='one',handles=bad)).status_code,400)
        response=client.post('/api/media/extract-audio',json=dict(project=p,clipId='one',handles=True))
        self.assertEqual(response.status_code,200);self.assertEqual(response.json['audioAnchor'],.25)
        p['videoClips'][0]['timeRemap'].update(freezeAt=.5,freezeDuration=1)
        self.assertEqual(client.post('/api/media/extract-audio',json=dict(project=p,clipId='one',handles=True)).status_code,400)
        linked=self.project();linked['tracks']['sound']=dict(source=dict(name='full.wav',size=100,lastModified=0,duration=2))
        linked['clipLinks']=[dict(id='link',video='one',audio='sound',audioAnchor=.25)]
        self.assertEqual(validate_project(linked)['clipLinks'][0]['audioAnchor'],.25)
        for bad in [-1,3,True,'1',float('nan')]:
            linked['clipLinks'][0]['audioAnchor']=bad
            with self.subTest(anchor=bad),self.assertRaises(ValueError):validate_project(linked)
        # Three output frames at 60 fps must survive subtraction rounding.
        valid=self.project();valid['tracks']['sound']=dict(source=dict(name='full.wav',size=100,lastModified=0,duration=2),start=1.15,end=1.2)
        self.assertAlmostEqual(validate_project(valid)['tracks']['sound']['end']-1.15,.05)

    def test_api_validates_request_busy_no_audio_and_private_download_paths(self):
        client=app.app.test_client();p=self.project()
        for body in [None,{},dict(project=p,clipId='missing'),dict(project=p,clipId='one',path='../private')]:
            with self.subTest(body=body):self.assertEqual(client.post('/api/media/extract-audio',json=body).status_code,400)
        # A different clock avoids a previous test's cache.
        p['videoClips'][0]['speed']=1.13
        with patch('video_audio_api.prepare_audio',side_effect=ValueError('Kontrollü hata')):
            response=client.post('/api/media/extract-audio',json=dict(project=p,clipId='one'))
            self.assertEqual(response.status_code,400)
        self.assertTrue(app.MEDIA_SLOT.acquire(blocking=False));app.MEDIA_SLOT.release()
        app.MEDIA_SLOT.acquire()
        try:self.assertEqual(client.post('/api/media/extract-audio',json=dict(project=p,clipId='one')).status_code,429)
        finally:app.MEDIA_SLOT.release()
        p['videoClips'][0]['asset']=self.silent['asset']
        response=client.post('/api/media/extract-audio',json=dict(project=p,clipId='one'))
        self.assertEqual(response.status_code,400);self.assertIn('ses kanalı',response.json['message'])
        response=client.post('/api/media/extract-audio',json=dict(project=self.project(),clipId='one'))
        self.assertEqual(response.status_code,200)
        downloaded=client.get(response.json['url']);self.assertEqual(downloaded.status_code,200);self.assertTrue(downloaded.data.startswith(b'RIFF'))
        downloaded.close()
        self.assertEqual(client.get('/api/media/'+self.info['asset']+'/audio/'+'x'*64).status_code,404)
        self.assertEqual(client.post('/api/media/extract-audio',json=dict(project=self.project(),clipId='one'),headers={'Origin':'https://example.com'}).status_code,403)

    def test_link_contract_roundtrips_and_rejects_invalid_or_duplicate_members(self):
        p=self.project();p['tracks']['track_sound']=dict(source=dict(name='audio.wav',size=100,lastModified=0,duration=1))
        p['clipLinks']=[dict(id='link',video='one',audio='track_sound',enabled=True,signature='clock')]
        result=validate_project(p);self.assertEqual(validate_project(result),result)
        for invalid in [None,True,{},[dict(p['clipLinks'][0],audio='main')],[dict(p['clipLinks'][0],enabled=1)],p['clipLinks']*2]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):validate_project(dict(p,clipLinks=invalid))

    def test_authored_linked_audio_reaches_mp4_at_moved_position(self):
        p=self.project();plan=extraction_plan(p,'one');metadata=prepare_audio(plan,self.ffmpeg)
        main=self.root/'main.wav'
        with wave.open(str(main),'wb') as out:
            out.setnchannels(2);out.setsampwidth(2);out.setframerate(44100);out.writeframes(b'\0'*3*44100*4)
        p['tracks']['main'].update(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=3),end=3,muted=True,loop=False)
        p['background']['asset']=self.info['asset'];p['output']['resolution']='source'
        script="""const fs=require('fs'),vm=require('vm');const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
          vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',c);
          for(const name of ['project','video-time','scene-renderer','parameter-curves','editing','clip-linking'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);
          c.raw=JSON.parse(fs.readFileSync(0,'utf8'));vm.runInContext(`const p=validateProject(raw.project),infos=new Map([[raw.info.asset,raw.info]]);attachVideoAudio(p,infos,'one','track_sound',raw.source);projectStore.replace(p);projectStore.update(p=>{p.videoClips[0].offset=.5;});`,c);
          process.stdout.write(vm.runInContext('JSON.stringify(projectStore.snapshot())',c));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,info=self.info,source=metadata['source'])),
            cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        authored=validate_project(json.loads(result.stdout));self.assertEqual(authored['tracks']['track_sound']['offset'],.5)
        video=media_assets.source_path(self.info['asset']);output=self.root/'linked-audio.mp4'
        ok,message=engine.process_and_render(authored,dict(main=str(main),track_sound=str(audio_file(self.info['asset'],plan['digest'])),background=video,clip_paths=[video]),str(output))
        self.assertTrue(ok,message)
        decoded=subprocess.run([self.ffmpeg,'-v','error','-i',str(output),'-vn','-ac','2','-ar','44100','-f','f32le','pipe:1'],capture_output=True,check=True)
        data=np.frombuffer(decoded.stdout,dtype='<f4').reshape(-1,2)
        self.assertLess(np.max(np.abs(data[:int(.4*44100)])),.001)
        self.assertGreater(np.sqrt(np.mean(data[int(.6*44100):int(1.3*44100)]**2)),.05)
        self.assertLess(np.max(np.abs(data[int(1.65*44100):int(2.8*44100)])),.001)

    def test_j_and_l_cuts_mix_real_handles_across_video_cut_in_mp4(self):
        p=self.project();p['videoClips'][0].update(start=.5,end=1.5,offset=.5)
        p['videoClips'].append(dict(p['videoClips'][0],id='two',offset=1.5))
        full=extraction_plan(p,'one',True);metadata=prepare_audio(full,self.ffmpeg)
        main=self.root/'split-main.wav'
        with wave.open(str(main),'wb') as target:
            target.setnchannels(2);target.setsampwidth(2);target.setframerate(44100);target.writeframes(b'\0'*3*44100*4)
        p['tracks']['main'].update(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=3),end=3,muted=True,loop=False)
        p['background']['asset']=self.info['asset'];p['output']['resolution']='source'
        script="""const fs=require('fs'),vm=require('vm');const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
          vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',c);
          for(const name of ['project','video-time','scene-renderer','parameter-curves','editing','clip-linking','split-cuts'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);
          c.raw=JSON.parse(fs.readFileSync(0,'utf8'));vm.runInContext(`const p=validateProject(raw.project),infos=new Map([[raw.info.asset,raw.info]]);
            attachVideoAudio(p,infos,'one','sound_one',raw.audio.source,raw.audio.audioAnchor);
            attachVideoAudio(p,infos,'two','sound_two',raw.audio.source,raw.audio.audioAnchor);projectStore.replace(p);
            projectStore.update(p=>{applySplitCut(p,infos,p.clipLinks[0].id,0,.25);applySplitCut(p,infos,p.clipLinks[1].id,-.25,0);});`,c);
          process.stdout.write(vm.runInContext('JSON.stringify(projectStore.snapshot())',c));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(dict(project=p,info=self.info,audio=metadata)),
            cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);authored=validate_project(json.loads(result.stdout))
        self.assertEqual([clip['offset'] for clip in authored['videoClips']],[.5,1.5])
        video=media_assets.source_path(self.info['asset']);audio=str(audio_file(self.info['asset'],full['digest']));output=self.root/'j-l-cut.mp4'
        ok,message=engine.process_and_render(authored,dict(main=str(main),sound_one=audio,sound_two=audio,background=video,clip_paths=[video,video]),str(output))
        self.assertTrue(ok,message)
        result=subprocess.run([self.ffmpeg,'-v','error','-i',str(output),'-vn','-ac','2','-ar','44100','-f','f32le','pipe:1'],capture_output=True,check=True)
        data=np.frombuffer(result.stdout,dtype='<f4').reshape(-1,2)
        _,pcm=wavfile.read(audio);samples=pcm.astype(np.float64)/32768;expected=np.zeros_like(data)
        for track in [authored['tracks']['sound_one'],authored['tracks']['sound_two']]:
            start,stop=round(track['offset']*44100),round(track['until']*44100);source=round(track['start']*44100)
            expected[start:stop]+=samples[source:source+stop-start]
        self.assertLess(np.sqrt(np.mean((data[:len(expected)]-expected)**2)),.015)
        self.assertLess(np.max(np.abs(data[:int(.4*44100)])),.001)
        self.assertGreater(np.sqrt(np.mean(data[int(1.3*44100):int(1.7*44100)]**2)),.05)
        self.assertLess(np.max(np.abs(data[int(2.65*44100):int(2.9*44100)])),.001)
