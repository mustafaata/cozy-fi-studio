"""Decode real MP4 output and compare it with the actual studio's canvas layers."""
import base64
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from browser_helpers import wait_for_browser
from unittest.mock import patch

import numpy as np
from PIL import Image
from pedalboard.io import AudioFile
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server, WSGIRequestHandler

import app
import engine
import media_assets
from overlay_assets import prepare_overlay, overlay_path
from project import validate_project


class CanvasParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="canvas-parity-")
        cls.root = Path(cls.temp.name)
        cls.assets = patch.object(media_assets, "ASSET_DIR", cls.root / "assets"); cls.assets.start()
        cls.ffmpeg = engine._ffmpeg_bin()
        cls.audio = cls.root / "audio.wav"
        subprocess.run([cls.ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                        "aevalsrc=0.3*sin(2*PI*110*t)*(0.4+0.6*sin(2*PI*3*t)^2):s=44100:d=3",
                        str(cls.audio)], check=True)
        cls.media = []
        for index, source in enumerate(("testsrc2=s=256x144:r=24:d=2", "color=c=0x996633:s=192x144:r=24:d=2")):
            video = cls.root / f"source{index}.mp4"
            subprocess.run([cls.ffmpeg, "-v", "error", "-f", "lavfi", "-i", source,
                            "-c:v", "libx264", "-crf", "12", str(video)], check=True)
            cls.media.append(media_assets.prepare_asset(video, video.name, cls.ffmpeg))
        buf = io.BytesIO(); Image.new("RGBA", (100, 60), (210, 185, 95, 180)).save(buf, format="PNG")
        cls.overlay = prepare_overlay(buf.getvalue(), "layer.png")
        gif=cls.root/'animated.gif'
        Image.new('RGB',(128,72),'#305575').save(gif,save_all=True,
            append_images=[Image.new('RGB',(128,72),'#b88542')],duration=500,loop=0)
        cls.gif=media_assets.prepare_asset(gif,gif.name,cls.ffmpeg)

        class QuietHandler(WSGIRequestHandler):
            def log_request(self, *args, **kwargs):
                pass
        cls.server = make_server("127.0.0.1", 0, app.app, threaded=True, request_handler=QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=3)
        cls.assets.stop(); cls.temp.cleanup()

    def project(self):
        with AudioFile(str(self.audio)) as handle:duration=handle.frames/handle.samplerate
        return validate_project(dict(version=1, tracks={"main": {
            "source": dict(name=self.audio.name, size=self.audio.stat().st_size, lastModified=0, duration=duration), "end":1.5}},
            effects=dict(speed=1,reverb=0), background=dict(asset=self.media[0]["asset"])))

    def compare(self, project, times, compare_raw=False):
        target = self.root / "result.mp4"
        files = dict(main=str(self.audio), background=media_assets.source_path(project["background"]["asset"]))
        if project["videoClips"]:
            files["clip_paths"] = [media_assets.source_path(clip["asset"]) for clip in project["videoClips"]]
        if project["overlay"]["asset"]:
            files["overlay"] = overlay_path(project["overlay"]["asset"])
        raw_frames={}
        if compare_raw:
            import canvas_render
            wanted={round(t*float(project['output']['fps'])) for t in times};write=canvas_render.FrameSink.write
            def capture(sink,data):
                offset=0;frame=sink.received
                while offset<len(data):
                    length=int.from_bytes(data[offset:offset+4],'big');offset+=4
                    if frame in wanted:raw_frames[frame]=data[offset:offset+length]
                    frame+=1;offset+=length
                return write(sink,data)
            with patch.object(canvas_render.FrameSink,'write',capture):ok,message=engine.process_and_render(project,files,str(target))
        else:ok, message = engine.process_and_render(project, files, str(target))
        self.assertTrue(ok, message)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chromium", args=["--enable-unsafe-swiftshader"])
            try:
                page = browser.new_page(); errors=[]; page.on("pageerror", lambda error: errors.append(str(error)))
                page.route('**/api/lyrics/search?**',lambda route:route.fulfill(json=dict(items=[])))
                page.goto(self.origin)
                page.locator('#mainUpload').set_input_files(str(self.audio))
                wait_for_browser(page, 'audioEngine.files.main && audioEngine.wsMain.getDecodedData()')
                page.evaluate('p => projectStore.replace(p)', project)
                if project['video'].get('reactiveFx',{}).get('preset'):
                    page.evaluate("async()=>{await reactiveAnalysisEditor.prepare();if(!reactiveAnalysisEditor.analysis)throw new Error(reactiveAnalysisEditor.$('.reactive-status').textContent);}")
                wait_for_browser(page, 'videoPreview.ready && !videoPreview.busy')
                wait_for_browser(page, 'videoPreview.visuals.isReady()')
                page.evaluate('document.fonts.ready')
                if project["overlay"]["asset"]:
                    wait_for_browser(page, "performance.getEntriesByType('resource').some(x=>x.name.includes('/api/overlay/'))")
                for time in times:
                    page.evaluate('async time => {await audioEngine.mainMontage.ready();audioEngine.seekProjectTime(time);}', time)
                    try:
                        wait_for_browser(page, "!videoPreview.video.seeking && videoPreview.timeSampler.settled() && videoPreview.temporalSettled() && videoPreview.clips.entries.every(entry=>entry.video.readyState>=2&&!entry.video.seeking&&entry.sampler.settled())&&[...videoPreview.visuals.entries.values()].every(entry=>entry.presentedFrame!==false&&(entry.source.readyState===undefined||entry.source.readyState>=2)&&!entry.source.seeking&&(!entry.sampler||entry.sampler.settled()))")
                    except AssertionError as error:
                        state=page.evaluate("""() => ({time:audioEngine.getProjectTime(),
                            videos:[videoPreview.video,...[...videoPreview.visuals.entries.values()].map(e=>e.source)].map(v=>({time:v.currentTime,duration:v.duration,seeking:v.seeking,ready:v.readyState,paused:v.paused})),
                            layers:projectStore.state.visualLayers,infos:[...videoPreview.visuals.entries.values()].map(e=>e.info)})""")
                        self.fail(f'{error}: {state}')
                    png = page.evaluate('''() => {
                        videoPreview.draw();lyricsPreview.draw();overlayPreview.draw();
                        const canvas=document.createElement('canvas'),base=document.getElementById('previewCanvas');
                        canvas.width=base.width;canvas.height=base.height;const ctx=canvas.getContext('2d');
                        for(const id of ['previewCanvas','overlayCanvas','lyricsCanvas'])ctx.drawImage(document.getElementById(id),0,0);
                        return canvas.toDataURL('image/png').split(',')[1];
                    }''')
                    preview = np.asarray(Image.open(io.BytesIO(base64.b64decode(png))).convert('RGB'), dtype=float)
                    result = subprocess.run([self.ffmpeg, '-v', 'error', '-i', str(target), '-ss', str(time),
                                             '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], capture_output=True, check=True)
                    output = np.asarray(Image.open(io.BytesIO(result.stdout)).convert('RGB'), dtype=float)
                    if compare_raw:
                        # Validate the encoded file above, but isolate drawing
                        # parity from irreversible 4:2:0 chroma loss at 144h.
                        output=np.asarray(Image.open(io.BytesIO(raw_frames[round(time*float(project['output']['fps']))])).convert('RGB'),dtype=float)
                    self.assertEqual(preview.shape, output.shape)
                    difference = np.abs(preview-output)
                    luma=np.abs((preview-output) @ np.array([.2126,.7152,.0722])).mean()
                    if difference.mean()>=8 or luma>=4:
                        diagnostic=Path(__file__).resolve().parents[1]/'.local';diagnostic.mkdir(exist_ok=True)
                        identifier=project['video']['creativeFx']['preset'] or next((l.get('creativeFx',{}).get('preset','layer') for l in project['visualLayers'] if l.get('offset',0)<=time<(l.get('until') or 1.5)),'layer')
                        Image.fromarray(preview.astype(np.uint8)).save(diagnostic/f'parity-{identifier}-preview.png')
                        Image.fromarray(output.astype(np.uint8)).save(diagnostic/f'parity-{identifier}-mp4.png')
                        (diagnostic/f'parity-{identifier}.json').write_text(json.dumps(dict(time=time,mean=float(difference.mean()),luma=float(luma))),encoding='utf-8')
                        state=page.evaluate('''()=>({ready:videoPreview.ready,temporal:sceneTemporalActive(videoPreview.renderProject(),audioEngine.getProjectTime(),[videoPreview.info]),temporalPending:videoPreview.temporalPending,projectLayers:projectStore.state.visualLayers.map(l=>l.id),renderLayers:videoPreview.renderProject().visualLayers.map(l=>l.id),time:audioEngine.getProjectTime(),resources:[...videoPreview.visuals.entries].map(([id,e])=>({id,ready:e.ready,rangeError:e.rangeError,state:e.source.readyState,width:e.source.videoWidth,height:e.source.videoHeight,time:e.source.currentTime,samplerEnabled:e.sampler?.enabled,samplerPainted:e.sampler?.painted,sampleWidth:e.sampler?.image()?.width,visible:visualLayerVisible(projectStore.state,e.layer),opacity:e.layer.opacity,blend:e.layer.blend,timing:visualLayerTiming(e.layer,e.info,audioEngine.getProjectTime(),projectDuration(projectStore.state))}))})''')
                        (diagnostic/f'parity-{identifier}-state.json').write_text(json.dumps(state),encoding='utf-8')
                    # Delivery MP4 uses 4:2:0 chroma subsampling. Saturated one-pixel
                    # edges differ from RGB canvas even with a lossless video codec.
                    self.assertLess(difference.mean(),1.5 if compare_raw else 8,f't={time}, mean={difference.mean():.2f}')
                    self.assertLess(luma,1 if compare_raw else 4,f't={time}, luma={luma:.2f}')
                self.assertEqual(errors, [])
            finally:
                browser.close()

    def test_final_text_all_twenty_timed_captions_and_text_layers_match_real_mp4(self):
        for i in range(31,36):
            with self.subTest(preset=i):
                project=self.project();project['tracks']['main']['end']=1.2;project['output'].update(fps='30',resolution='720');project['video'].update(loop=False)
                project['lyrics'].update(enabled=True,timeBase='project',font='Arial',fontSize=48,outline=0,animation='none',textFx=dict(preset=f'TFX-{i}'),lines=[dict(id='words-a',text='Bir iki',start=0,end=.6,words=[dict(text='Bir',start=0,end=.3),dict(text='iki',start=.3,end=.6)]),dict(id='words-b',text='Sonraki satır',start=.6,end=1.2,words=[dict(text='Sonraki',start=.6,end=.9),dict(text='satır',start=.9,end=1.2)])])
                self.compare(project,[.2,.4,.8] if i==35 else [.2,.4])
        project=self.project();project['output'].update(fps='30',resolution='720');project['video'].update(loop=False);project['visualLayers']=[]
        for i in range(36,51):
            start=(i-36)*.1;parameters={'duration':.1} if i in (46,49,50) else {}
            project['visualLayers'].append(dict(id=f'text-{i}',type='title',width=75,offset=start,until=start+.1,title=dict(rows=[[dict(text='İstanbul O',font='Arial',size=52)],[dict(text='Alt açıklama',font='Arial',size=28)]]),textFx=dict(preset=f'TFX-{i}',parameters=parameters)))
        self.compare(project,[(i*3+1)/30 for i in range(15)])

    def test_final_reactive_all_twenty_real_spectral_source_and_caption_layers_match_mp4(self):
        audio=self.root/'reactive-finish.wav'
        subprocess.run([self.ffmpeg,'-v','error','-f','lavfi','-i','aevalsrc=if(between(t\,0.3\,0.48)\,0.3*sin(2*PI*220*t)+0.1*sin(2*PI*900*t)+0.08*sin(2*PI*5000*t)\,0):s=44100:d=2',str(audio)],check=True)
        with patch.object(self,'audio',audio):
            for i in range(31,51):
                with self.subTest(preset=i):
                    project=self.project();project['tracks']['main']['end']=.6;project['output'].update(fps='30',resolution='720');project['video'].update(loop=False)
                    parameters={'quiet':.1} if i==50 else {'trend':0} if i==49 else {}
                    project['video']['reactiveFx']=dict(preset=f'ARX-{i}',parameters=parameters)
                    project['lyrics'].update(enabled=True,timeBase='project',font='Arial',fontSize=48,outline=0,animation='none',lines=[dict(id='reactive-word',text='Bir iki',start=0,end=.6,words=[dict(text='Bir',start=0,end=.4),dict(text='iki',start=.4,end=.6)])])
                    project['visualLayers']=[dict(id='reactive-label',type='title',offset=0,until=.6,width=60)]
                    self.compare(project,[.3,.4,.5])

    def test_prepared_frequency_shift_is_muxed_into_actual_mp4_audio(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['tracks']['main']['audioFx']=dict(preset='AFX-34',amount=100,parameters=dict(shift=80,depth=0))
        self.compare(project,[.2,.7,1.3])
        result=subprocess.run([self.ffmpeg,'-v','error','-i',str(self.root/'result.mp4'),'-map','0:a:0','-ar','44100','-ac','1','-f','f32le','-'],capture_output=True,check=True)
        samples=np.frombuffer(result.stdout,dtype='<f4')[22050:55125];spectrum=abs(np.fft.rfft(samples*np.hanning(len(samples))));hz=np.fft.rfftfreq(len(samples),1/44100)
        self.assertAlmostEqual(float(hz[np.argmax(spectrum)]),190,delta=3)

    def test_final_video_all_fifteen_clip_effects_and_local_reveals_match_real_mp4(self):
        project=self.project();project['output'].update(fps='30',resolution='720');project['video'].update(loop=False)
        project['videoClips']=[]
        for i in range(36,51):
            parameters={'duration':.1} if i in (48,49,50) else {}
            if i==50:parameters['delay']=0
            project['videoClips'].append(dict(id=f'finish-{i}',asset=self.media[0]['asset'],start=0,end=.1,offset=(i-36)*.1,transitionDuration=0,creativeFx=dict(preset=f'VFX-{i}',parameters=parameters)))
        self.compare(project,[(i*3+1)/30 for i in range(15)])

    def test_split_screen_delayed_reverse_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='split-video',type='video',asset=self.media[0]['asset'],width=75,offset=.15,until=1.5,start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-47',parameters=dict(delay=.25),automation=dict(ratio=[[0,30],[1.5,70]],amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.3,.7,1.3])

    def test_reverse_echo_global_curves_future_transition_and_end_match_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False,opacity=85)
        project['video']['creativeFx']=dict(preset='VFX-35',parameters=dict(count=6),automation=dict(interval=[[0,.08],[1.5,.2]],falloff=[[0,0],[1.5,60]],amount=[[0,35],[1.5,100]]))
        project['videoClips']=[dict(id='first',asset=self.media[0]['asset'],start=0,end=1,offset=0,transitionDuration=0),
            dict(id='second',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[0,.3,.7,1.3,44/30])

    def test_reverse_echo_reverse_clip_inside_ghost_montage_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['video']['creativeFx']=dict(preset='VFX-31',parameters=dict(count=2,interval=.1))
        project['videoClips']=[dict(id='echoed',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            creativeFx=dict(preset='VFX-35',parameters=dict(count=3,interval=.15,falloff=20)),timeRemap=dict(reverse=True,smoothing='blend'),color=dict(enabled=True,saturation=.7)),
            dict(id='plain',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[.2,.7,1.3])

    def test_reverse_echo_phased_reverse_video_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='reverse-echo-video',type='video',asset=self.media[0]['asset'],width=75,offset=.15,until=1.5,
            start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-35',parameters=dict(count=5,interval=.1,falloff=20),automation=dict(amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.3,.7,1.3])

    def test_motion_smear_global_curves_match_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False,opacity=85)
        project['video']['creativeFx']=dict(preset='VFX-34',parameters=dict(count=6),automation=dict(trail=[[0,.1],[1.5,.7]],threshold=[[0,0],[1.5,30]],amount=[[0,35],[1.5,100]]))
        self.compare(project,[.1,.7,1.3])

    def test_motion_smear_reverse_clip_inside_ghost_montage_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['video']['creativeFx']=dict(preset='VFX-31',parameters=dict(count=2,interval=.1))
        project['videoClips']=[dict(id='smeared',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            creativeFx=dict(preset='VFX-34',parameters=dict(count=3,trail=.35,threshold=5)),timeRemap=dict(reverse=True,smoothing='blend'),color=dict(enabled=True,saturation=.7)),
            dict(id='plain',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[.2,.7,1.3])

    def test_motion_smear_phased_reverse_video_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='motion-smear-video',type='video',asset=self.media[0]['asset'],width=75,offset=.15,until=1.5,
            start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-34',parameters=dict(count=5,trail=.45,threshold=9),automation=dict(amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.3,.7,1.3])

    def test_shutter_global_hold_and_mix_curves_match_real_mp4_without_retiming(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False,opacity=85)
        project['video']['creativeFx']=dict(preset='VFX-33',automation=dict(hold=[[0,.12],[1.5,.4]],amount=[[0,100],[1.5,50]]))
        self.compare(project,[.1,.3,.6,1.1,1.3])
        info=media_assets.probe(self.root/'result.mp4',self.ffmpeg);self.assertAlmostEqual(info['duration'],1.5,delta=.05)

    def test_shutter_reverse_clip_inside_time_slice_montage_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['video']['creativeFx']=dict(preset='VFX-32',parameters=dict(count=3,delay=.2,softness=40))
        project['videoClips']=[dict(id='stuttered',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            creativeFx=dict(preset='VFX-33',parameters=dict(hold=.3,interval=.5,phase=25)),timeRemap=dict(reverse=True,smoothing='blend'),color=dict(enabled=True,saturation=.7)),
            dict(id='plain',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[.2,.4,.7,1.3])

    def test_shutter_phased_reverse_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='shutter-video',type='video',asset=self.media[0]['asset'],width=75,offset=.15,until=1.5,
            start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-33',parameters=dict(hold=.3,interval=.5,phase=0),automation=dict(amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.2,.6,.9,1.1])

    def test_time_slice_global_curves_both_axes_match_real_mp4(self):
        for direction in (0,3):
            with self.subTest(direction=direction):
                project=self.project();project['output']['fps']='30';project['video'].update(loop=False,opacity=85,fadeIn=.1)
                project['video']['creativeFx']=dict(preset='VFX-32',parameters=dict(count=7,direction=direction),automation=dict(delay=[[0,0],[1.5,1.2]],softness=[[0,0],[1.5,90]],amount=[[0,35],[1.5,100]]))
                self.compare(project,[.1,.7,1.3])

    def test_time_slice_clip_nested_ghost_and_transition_match_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['video']['creativeFx']=dict(preset='VFX-31',parameters=dict(count=2,interval=.12))
        project['videoClips']=[dict(id='sliced',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            creativeFx=dict(preset='VFX-32',parameters=dict(count=7,direction=1,softness=0,delay=1.5)),timeRemap=dict(reverse=True,smoothing='blend'),color=dict(enabled=True,saturation=.7)),
            dict(id='plain',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[.1,.7,1.3])

    def test_time_slice_phased_reverse_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='time-slice-video',type='video',asset=self.media[0]['asset'],width=75,offset=.1,until=1.5,
            start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-32',parameters=dict(count=5,direction=2,softness=100,delay=.8),automation=dict(amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.3,.7,1.3])

    def test_temporal_global_implicit_curves_match_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False,opacity=85,fadeIn=.1)
        project['video']['creativeFx']=dict(preset='VFX-31',parameters=dict(count=4),automation=dict(interval=[[0,.05],[1.5,.25]],falloff=[[0,10],[1.5,65]],amount=[[0,30],[1.5,100]]))
        self.compare(project,[.3,.7,1.3])

    def test_temporal_montage_nested_clip_trails_and_transition_match_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['video']['creativeFx']=dict(preset='VFX-31',parameters=dict(count=4,interval=.18))
        project['videoClips']=[dict(id='trail',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            creativeFx=dict(preset='VFX-31',parameters=dict(interval=.09)),timeRemap=dict(reverse=True,smoothing='blend'),color=dict(enabled=True,saturation=.7)),
            dict(id='plain',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5)]
        self.compare(project,[.3,.7,1.3])

    def test_temporal_phased_reverse_video_layer_matches_real_mp4(self):
        project=self.project();project['output']['fps']='30';project['video'].update(loop=False)
        project['visualLayers']=[dict(id='video-trail',type='video',asset=self.media[0]['asset'],width=65,offset=.1,until=1.5,
            start=.2,end=1.7,phase=.25,speed=1.3,loop=True,timeRemap=dict(reverse=True,smoothing='blend'),opacity=65,
            creativeFx=dict(preset='VFX-31',parameters=dict(count=5,interval=.12),automation=dict(amount=[[0,40],[1.5,100]])))]
        self.compare(project,[.3,.7,1.3])

    def test_creative_video_presets_all_ten_clips_match_real_mp4(self):
        project=self.project()
        project['video'].update(loop=False)
        project['output']['fps']='30'
        project['videoClips']=[dict(id=f'fx{i}',asset=self.media[0]['asset'],start=0,end=.1,
            offset=i*.1,transitionDuration=0,creativeFx=dict(preset=f'VFX-{i+1:02d}')) for i in range(10)]
        self.compare(project,[(i*3+1)/30 for i in range(10)])

    def test_creative_video_global_curve_and_video_layer_match_real_mp4(self):
        project=self.project()
        project['video']['creativeFx']=dict(preset='VFX-01',automation=dict(amount=[[0,10],[1.5,100]],warmth=[[0,0],[1.5,100]]))
        project['visualLayers']=[dict(id='fx-video',type='video',asset=self.media[1]['asset'],width=40,
            creativeFx=dict(preset='VFX-09',parameters=dict(curve=16)))]
        self.compare(project,[0,.25,.75,1.25])

    def test_geometry_video_all_five_global_curves_match_real_mp4(self):
        for identifier,key,low,high in [('VFX-21','refraction',3,22),('VFX-22','amplitude',2,15),('VFX-23','gap',8,45),('VFX-24','scale',.45,.85),('VFX-25','angle',-45,60)]:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30'
                # Saturated geometric edges need the delivery's 720p option;
                # a 144h 4:2:0 file discards chroma that is present in both canvases.
                if identifier in ('VFX-23','VFX-25'):project['output']['resolution']='720'
                project['video']['creativeFx']=dict(preset=identifier,automation=dict(amount=[[0,35],[1.5,100]],**{key:[[0,low],[1.5,high]]}))
                self.compare(project,[.3,.7,1.3])

    def test_digital_video_all_five_global_curves_match_real_mp4(self):
        for identifier,key,low,high in [('VFX-26','damage',20,80),('VFX-27','distance',5,35),('VFX-28','threshold',25,65),('VFX-29','contrast',.8,1.8),('VFX-30','hold',.05,.3)]:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30'
                project['video']['creativeFx']=dict(preset=identifier,automation=dict(amount=[[0,35],[1.5,100]],**{key:[[0,low],[1.5,high]]}))
                self.compare(project,[.3,.7,1.3])

    def test_geometry_and_digital_all_ten_transparent_image_layers_match_real_mp4(self):
        data=np.zeros((96,128,4),dtype=np.uint8)
        for y in range(8,88):
            for x in range(8,120):data[y,x]=[(x*3)%256,(y*3)%256,160,180]
        data[24:72,40:88]=[240,190,75,230]
        buffer=io.BytesIO();Image.fromarray(data).save(buffer,format='PNG');asset=prepare_overlay(buffer.getvalue(),'geometry-transparent.png')
        project=self.project();project['output']['fps']='30'
        project['output']['resolution']='720'
        project['visualLayers']=[dict(id=f'geometry-image-{i}',type='image',asset=asset['asset'],width=80,rotation=7,
            offset=i*.1,until=(i+1)*.1,creativeFx=dict(preset=f'VFX-{i+21}',parameters=dict(interval=.1,hold=.2) if i==9 else {})) for i in range(10)]
        project['videoClips']=[dict(id='corridor',asset=self.media[0]['asset'],start=0,end=1.5,creativeFx=dict(preset='VFX-24'))]
        self.compare(project,[(i*3+1)/30 for i in range(10)])

    def test_geometry_small_raw_output_frames_match_studio_before_codec(self):
        for identifier in ('VFX-23','VFX-25'):
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30';project['video']['creativeFx']=dict(preset=identifier)
                self.compare(project,[.3,.7,1.3],compare_raw=True)

    def test_optical_presets_all_ten_clips_match_real_mp4(self):
        project=self.project();project['video']['loop']=False;project['output']['fps']='30'
        project['videoClips']=[dict(id=f'optical{i}',asset=self.media[0]['asset'],start=0,end=.1,
            offset=i*.1,transitionDuration=0,creativeFx=dict(preset=f'VFX-{i+11:02}')) for i in range(10)]
        self.compare(project,[(i*3+1)/30 for i in range(10)])

    def test_optical_global_curve_window_clip_and_transparent_image_match_real_mp4(self):
        from PIL import ImageDraw
        image=Image.new('RGBA',(128,80),(0,0,0,0));draw=ImageDraw.Draw(image)
        draw.rectangle((20,12,108,68),fill=(230,120,60,180));draw.ellipse((54,30,74,50),fill=(255,255,255,240))
        path=self.root/'optical-layer.png';image.save(path);asset=prepare_overlay(path.read_bytes(),path.name)
        project=self.project();project['output']['fps']='30'
        project['videoClips']=[dict(id='window',asset=self.media[0]['asset'],start=0,end=1.5,creativeFx=dict(preset='VFX-19'))]
        project['video']['creativeFx']=dict(preset='VFX-15',parameters=dict(radius=18,threshold=50),automation=dict(amount=[[0,10],[1.5,100]]))
        project['visualLayers']=[dict(id='optical-image',type='image',asset=asset['asset'],width=35,x=72,y=30,creativeFx=dict(preset='VFX-12',parameters=dict(radius=24))),dict(id='label',type='text',text='İstanbul',fontSize=70,y=80)]
        self.compare(project,[0,.3,.8,1.2])

    def test_text_presets_all_ten_text_and_rich_title_layers_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['visualLayers']=[dict(id=f'textfx{i}',type='title' if i%2 else 'text',text='İstanbul é',
            offset=i*.1,until=(i+1)*.1,width=85,fontSize=100,
            title=dict(rows=[[dict(text='İstanbul ',color='#f0b070'),dict(text='é',bold=True,color='#b5b9ff')]],enter='none',exit='none'),
            textFx=dict(preset=f'TFX-{i+1:02d}')) for i in range(10)]
        self.compare(project,[(i*3+1)/30 for i in range(10)])

    def test_text_contour_presets_all_five_text_and_rich_title_layers_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['visualLayers']=[dict(id=f'contour{i}',type='title' if i%2 else 'text',text='İstanbul O',
            offset=i*.3,until=(i+1)*.3,width=85,fontSize=100,
            title=dict(rows=[[dict(text='İstanbul ',font='Georgia',italic=True,color='#f0b070'),dict(text='O',bold=True,color='#b5b9ff')]],enter='none',exit='none'),
            textFx=dict(preset=f'TFX-{i+11:02d}')) for i in range(5)]
        self.compare(project,[(i*9+2)/30 for i in range(5)]+[(i*9+7)/30 for i in range(5)])

    def test_text_materials_all_five_plain_and_rich_title_layers_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['visualLayers']=[dict(id=f'material{i}',type='title' if i%2 else 'text',text='İstanbul O',
            offset=i*.3,until=(i+1)*.3,width=85,fontSize=100,rotation=-8+i*4,
            title=dict(rows=[[dict(text='İstanbul ',font='Georgia',italic=True,color='#f0b070'),dict(text='O',bold=True,color='#b5b9ff')]],enter='none',exit='none'),
            textFx=dict(preset=f'TFX-{i+16:02d}')) for i in range(5)]
        self.compare(project,[(i*9+2)/30 for i in range(5)]+[(i*9+7)/30 for i in range(5)])

    def assert_kinetic_text_delivery(self, first, last):
        from project import SCHEMA
        for index in range(first,last+1):
            with self.subTest(preset=f'TFX-{index}'):
                preset=next(p for p in SCHEMA['creativeTextPresets'] if p['id']==f'TFX-{index}')
                key=next(k for k in preset['parameterOrder'] if preset['parameters'][k]['automatable'])
                spec=preset['parameters'][key]
                fx=dict(preset=preset['id'],automation={key:[[0,spec['default']],[1.5,spec['max']]],'amount':[[0,35],[1.5,100]]})
                project=self.project();project['output']['fps']='30'
                project['lyrics'].update(enabled=True,timeBase='project',template='karaoke',animation='none',wordAnimation='none',fontSize=65,outline=1,
                    lines=[dict(id='kinetic-cue',text='İstanbul ışığı',start=0,end=1.5,words=[dict(text='İstanbul',start=0,end=.75),dict(text='ışığı',start=.75,end=1.5)])],textFx=fx)
                project['visualLayers']=[dict(id='kinetic-plain',type='text',text='İ ş é',fontSize=55,x=50,y=20,textFx=fx),
                    dict(id='kinetic-title',type='title',y=45,width=80,rotation=5,textFx=fx,mask=dict(enabled=True),
                         title=dict(rows=[[dict(text='Gece ',size=55,color='#f0c080'),dict(text='O',size=65,bold=True,color='#a0d0ff')]],background=False,accentWidth=0,padding=35,enter='none',exit='none'))]
                self.compare(project,[1/30,.3,.7,1.3])

    def test_digital_text_all_five_plain_rich_title_and_karaoke_curves_match_real_mp4(self):
        self.assert_kinetic_text_delivery(21,25)

    def test_kinetic_text_all_five_plain_rich_title_and_karaoke_curves_match_real_mp4(self):
        self.assert_kinetic_text_delivery(26,30)

    def test_glass_karaoke_overlay_and_automated_refraction_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['overlay'].update(asset=self.overlay['asset'],x=50,y=62,scale=230,opacity=70)
        project['lyrics'].update(enabled=True,timeBase='project',template='karaoke',animation='pop',wordAnimation='slide',fontSize=110,
            boxStyle='pill',backgroundOpacity=.35,outline=1,
            lines=[dict(id='glass-cue',text='İstanbul ışığı',start=0,end=1.5,words=[dict(text='İstanbul',start=0,end=.75),dict(text='ışığı',start=.75,end=1.5)])],
            textFx=dict(preset='TFX-18',amount=0,automation=dict(amount=[[0,20],[1.5,100]],refraction=[[0,0],[1.5,25]],blur=[[0,0],[1.5,8]])))
        project['visualLayers']=[dict(id='lower',type='text',text='Alt katman',y=25,fontSize=80,textFx=dict(preset='TFX-20'))]
        self.compare(project,[1/30,.2,.5,1,1.4])

    def test_glass_rich_title_motion_mask_perspective_and_decoration_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['visualLayers']=[dict(id='lower',type='text',text='ALT KATMAN',fontSize=110,y=50,textColor='#f02830'),
            dict(id='glass-title',type='title',rotation=17,width=85,
                title=dict(rows=[[dict(text='İstanbul ',font='Georgia',italic=True,size=95),dict(text='O',bold=True,size=70)]],background=True,backgroundOpacity=35,accentWidth=8,enter='scale',exit='left',enterDuration=.4,exitDuration=.3),
                perspective=dict(enabled=True,points=[[4,3],[96,0],[87,97],[5,90]]),mask=dict(enabled=True),
                textFx=dict(preset='TFX-18',automation=dict(opacity=[[0,40],[1.5,95]],refraction=[[0,2],[1.5,20]])))]
        self.compare(project,[1/30,.2,.5,1,1.4])

    def test_text_contours_karaoke_curves_chase_and_erase_match_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['lyrics'].update(enabled=True,timeBase='project',template='karaoke',animation='none',wordAnimation='none',fontSize=90,
            lines=[dict(id='contour-cue',text='İstanbul ışığı',start=0,end=1.5,words=[dict(text='İstanbul',start=0,end=.75),dict(text='ışığı',start=.75,end=1.5)])],
            textFx=dict(preset='TFX-13',automation=dict(amount=[[0,40],[1.5,100]],density=[[0,0],[1.5,80]])))
        project['visualLayers']=[dict(id='chase',type='title',y=25,title=dict(rows=[[dict(text='Gece O',color='#f0b070')]],enter='none',exit='none'),textFx=dict(preset='TFX-14',automation=dict(width=[[0,2],[1.5,10]]))),
            dict(id='erase',type='text',text='Sönen ışık',y=75,fontSize=70,textFx=dict(preset='TFX-15'))]
        self.compare(project,[1/30,.2,.5,1,1.4])

    def test_reactive_spectrum_geometry_all_five_match_real_mp4(self):
        for identifier,key,low,high in [('ARX-06','height',30,85),('ARX-07','rotation',-80,80),('ARX-08','hue',170,300),('ARX-09','curve',.5,2),('ARX-10','thickness',3,15)]:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30';project['tracks']['main'].update(fadeIn=0,fadeOut=0)
                project['video']['reactiveFx']=dict(preset=identifier,automation=dict(amount=[[0,35],[1.5,100]],**{key:[[0,low],[1.5,high]]}))
                self.compare(project,[.3,.7,1.3])

    def assert_reactive_field_delivery(self, cases):
        from pedalboard.io import AudioFile
        t=np.arange(44100*3)/44100;gate=((t%.5)>.05)&((t%.5)<.22)
        left=(.2*np.sin(2*np.pi*110*t)+.12*np.sin(2*np.pi*900*t)+.08*np.sin(2*np.pi*4800*t))*gate
        self.audio=self.root/'field-bands.wav'
        with AudioFile(str(self.audio),'w',44100,2,bit_depth=24) as handle:handle.write(np.stack([left,left*.8]).astype(np.float32))
        for identifier,key,low,high in cases:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30';project['tracks']['main'].update(fadeIn=0,fadeOut=0,bus='field-bus')
                project['audioBuses']=[dict(id='field-bus',name='Alan sesi',audioFx=dict(preset='AFX-11',amount=35,parameters=dict(delay=80)))]
                project['video']['reactiveAnalysis']=dict(source='b:field-bus',point='post')
                parameters=dict(threshold=5) if identifier in ('ARX-21','ARX-26') else {}
                project['video']['reactiveFx']=dict(preset=identifier,parameters=parameters,automation=dict(amount=[[0,35],[1.5,100]],**{key:[[0,low],[1.5,high]]}))
                project['visualLayers']=[dict(id='top-label',type='text',text='İstanbul',fontSize=55,y=15)]
                self.compare(project,[.3,.7,1.3])

    def test_reactive_field_surfaces_all_five_curves_and_selected_bus_match_real_mp4(self):
        self.assert_reactive_field_delivery([('ARX-21','height',10,90),('ARX-22','directionGain',20,280),('ARX-23','camera',20,75),('ARX-24','deformation',5,70),('ARX-25','width',3,20)])

    def test_reactive_field_polygons_all_five_curves_and_selected_bus_match_real_mp4(self):
        self.assert_reactive_field_delivery([('ARX-26','delay',.01,.1),('ARX-27','step',8,35),('ARX-28','radius',5,25),('ARX-29','depth',10,90),('ARX-30','morph',10,95)])

    def test_reactive_stereo_geometry_all_five_match_real_mp4(self):
        from pedalboard.io import AudioFile
        t=np.arange(44100*3)/44100;left=.3*np.sin(2*np.pi*110*t)*(.3+.7*np.sin(2*np.pi*3*t)**2);right=.25*np.sin(2*np.pi*165*t+.7)*(.4+.6*np.cos(2*np.pi*2*t)**2)
        self.audio=self.root/'stereo-geometry.wav'
        with AudioFile(str(self.audio),'w',44100,2,bit_depth=24) as handle:handle.write(np.stack([left,right]).astype(np.float32))
        for identifier,key,low,high in [('ARX-11','scale',100,300),('ARX-12','rotation',-80,80),('ARX-13','angle',10,70),('ARX-14','range',40,150),('ARX-15','perspective',.3,1.3)]:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30';project['tracks']['main'].update(fadeIn=0,fadeOut=0)
                project['video']['reactiveFx']=dict(preset=identifier,automation=dict(amount=[[0,35],[1.5,100]],**{key:[[0,low],[1.5,high]]}))
                self.compare(project,[.3,.7,1.3])

    def test_reactive_presets_all_ten_match_real_mp4(self):
        for identifier in ['ARX-01','ARX-02','ARX-03','ARX-04','ARX-05','ARX-16','ARX-17','ARX-18','ARX-19','ARX-20']:
            with self.subTest(preset=identifier):
                project=self.project();project['output']['fps']='30'
                project['tracks']['main'].update(fadeIn=0,fadeOut=0)
                # A shared band isolates renderer parity from drum classification.
                project['video']['reactiveFx']=dict(preset=identifier,parameters=dict(bandLow=40,bandHigh=1000,threshold=5))
                project['video']['reactiveAnalysis']=dict(source='t:main',point='post')
                self.compare(project,[.2,.5,.8])

    def test_reactive_bus_pre_post_curve_and_layers_match_real_mp4(self):
        for point in ('pre','post'):
            with self.subTest(point=point):
                project=self.project();project['output']['fps']='30'
                project['audioBuses']=[dict(id='echo',name='Echo',audioFx=dict(preset='AFX-11',amount=100,parameters=dict(delay=100,tone=18000)))]
                project['tracks']['main'].update(bus='echo',fadeIn=0,fadeOut=0)
                project['video']['reactiveAnalysis']=dict(source='b:echo',point=point)
                project['video']['reactiveFx']=dict(preset='ARX-05',parameters=dict(bandLow=40,bandHigh=1000),automation=dict(amount=[[0,10],[1.5,100]],tilt=[[0,0],[1.5,30]]))
                project['visualLayers']=[dict(id='title',type='text',text='İstanbul',fontSize=70,y=25)]
                self.compare(project,[.1,.3,.8,1.2])

    def test_text_mask_and_glyph_presets_preserve_karaoke_in_real_mp4(self):
        project=self.project();project['output']['fps']='30'
        project['lyrics'].update(enabled=True,timeBase='project',template='karaoke',animation='none',fontSize=90,
            lines=[dict(id='fx-cue',text='İstanbul ışığı',start=0,end=1.5,words=[dict(text='İstanbul',start=0,end=.75),dict(text='ışığı',start=.75,end=1.5)])],
            textFx=dict(preset='TFX-08',parameters=dict(reverse=1),automation=dict(amount=[[0,100],[1.5,50]])))
        project['visualLayers']=[dict(id='letters',type='text',text='Gece é',y=25,fontSize=70,textFx=dict(preset='TFX-05'))]
        self.compare(project,[1/30,.2,.5,1,1.4])

    def test_masks_background_animation_feather_inversion_and_blur_match_export(self):
        project=self.project()
        project['video'].update(linkSpeed=False,loop=False,rotation=12,fit='contain',zoom=.9,
            mask=dict(enabled=True,shape='ellipse',mode='blur',invert=True,width=50,height=60,blur=4,feather=2,
                keyframes=dict(x=[[0,25,dict(type='smooth')],[1.5,75]],rotation=[[0,-20],[1.5,30]])))
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_masks_clip_polygon_soft_edge_grade_transition_and_clock_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False,rotation=-8,fit='contain')
        project['videoClips']=[dict(id='one',asset=self.media[0]['asset'],start=0,end=1,offset=0,transitionDuration=0,
            mask=dict(enabled=True,shape='rectangle',width=85,height=80,feather=2),color=dict(temperature=12)),
            dict(id='two',asset=self.media[1]['asset'],start=0,end=1,offset=.5,transitionDuration=.5,transition='zoom',transitionDirection='out',
                mask=dict(enabled=True,shape='polygon',width=70,height=90,clockOffset=.25,points=[[0,0],[100,25],[65,100],[10,70]],
                    keyframes=dict(x=[[0,10],[1.5,90]],rotation=[[0,0],[1.5,40]])),color=dict(exposure=.2))]
        self.compare(project,[.25,.5,.625,.75,.875,1.25])

    def test_masks_visual_video_image_and_text_combine_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['visualLayers']=[dict(id='video',type='video',asset=self.media[1]['asset'],width=80,x=50,y=50,
            mask=dict(enabled=True,shape='ellipse',width=55,height=75,feather=2,keyframes=dict(x=[[0,20],[1.5,80]]))),
            dict(id='image',type='image',asset=self.overlay['asset'],width=70,opacity=75,blend='screen',
                mask=dict(enabled=True,shape='polygon',invert=True,points=[[0,0],[100,0],[50,100]],rotation=25)),
            dict(id='text',type='text',text='Maske ile\nbirleşen sahne',font='Arial',fontSize=85,width=75,
                mask=dict(enabled=True,shape='rectangle',mode='blur',width=35,height=80,blur=3,feather=1))]
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_time_reverse_eased_ramp_and_frame_blend_match_export(self):
        project=self.project()
        project['video'].update(start=.125,end=1.875,linkSpeed=False,speed=.75,loop=False,
            timeRemap=dict(reverse=True,smoothing='blend',ramp=[[.125,.5,'smooth'],[1,2,'linear'],[1.875,.75,'hold']]))
        self.compare(project,[0,.125,.375,.625,1,1.375])

    def test_custom_word_karaoke_source_offset_speed_and_montage_repeats_match_export(self):
        project=self.project()
        project['effects']['speed']=.5
        project['mainClips']=[dict(id='first',start=.5,end=1,offset=0),dict(id='repeat',start=.5,end=1,offset=1.5)]
        project['lyrics'].update(template='karaoke',animation='none',fontSize=70,offset=.125,
            lines=[dict(id='words',text='İçimde ışık',start=.25,end=1,
                words=[dict(text='İçimde',start=.375,end=.625),dict(text='ışık',start=.75,end=.875)])])
        self.compare(project,[0,.25,.5,.75,1.25,1.75,2,2.25])

    def test_custom_word_typewriter_and_entrance_modes_match_export(self):
        project=self.project()
        project['lyrics'].update(animation='fade',fontSize=64,wordEntrance=.24,y=30,width=50,
            textTransform='uppercase',lines=[dict(id='words',text='ışık İstanbul geceleri',start=0,end=1.5,
                words=[dict(text='ışık',start=.125,end=.375),dict(text='İstanbul',start=.625,end=.875),
                       dict(text='geceleri',start=1,end=1.375)])])
        for mode in ['typewriter','fade','pop','slide']:
            with self.subTest(mode=mode):
                project['lyrics']['wordAnimation']=mode
                self.compare(project,[.125,.25,.5,.75,1.125,1.375])

    def author_video_edit(self,project,commands):
        root=Path(__file__).resolve().parents[1]
        script="""const fs=require('fs'),vm=require('vm');
          const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
          for(const file of ['project','video-time','scene-renderer','editing','slip-editing','video-trim','slide-editing','rolling-editing'])vm.runInContext(fs.readFileSync('static/js/'+file+'.js','utf8'),c);
          c.raw=JSON.parse(fs.readFileSync(0,'utf8'));
          vm.runInContext(`const p=validateProject(raw.project),infos=new Map(p.videoClips.map(clip=>[clip.asset,{duration:2,fps:24}]));`,c);
          vm.runInContext(c.raw.commands,c);
          process.stdout.write(vm.runInContext('JSON.stringify(p)',c));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(dict(project=project,commands=commands)),cwd=root,text=True,capture_output=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        return validate_project(json.loads(result.stdout))

    def test_authored_slip_reverse_ramp_freeze_and_transition_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='ramp',asset=self.media[0]['asset'],start=.125,end=.875,offset=0,transitionDuration=0,
            timeRemap=dict(reverse=True,smoothing='blend',ramp=[[.125,.75,'smooth'],[.875,1.5,'hold']])),
            dict(id='freeze',asset=self.media[0]['asset'],start=.25,end=1.5,offset=.5,transitionDuration=.25,
                timeRemap=dict(freezeAt=.625,freezeDuration=1),color=dict(exposure=.25))]
        authored=self.author_video_edit(project,"""
            const before=videoEditTimeline(p,infos).map(i=>[i.offset,i.end]);
            slipVideoClip(p,infos,'ramp',.75);slipVideoClip(p,infos,'freeze',.25);
            if(JSON.stringify(before)!==JSON.stringify(videoEditTimeline(p,infos).map(i=>[i.offset,i.end])))throw Error('Timeline changed');
        """)
        self.assertEqual(authored['videoClips'][0]['start'],.875)
        self.assertEqual(authored['videoClips'][1]['timeRemap']['freezeAt'],.875)
        self.compare(authored,[0,.125,.375,.5,.625,.875,1.375])

    def test_authored_slide_reverse_ramp_masks_and_transitions_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=.875,offset=0,transitionDuration=0,
            timeRemap=dict(reverse=True,smoothing='blend',ramp=[[0,.75,'smooth'],[2,1.5,'hold']])),
            dict(id='middle',asset=self.media[1]['asset'],start=.25,end=.75,offset=None,transitionDuration=.125,color=dict(exposure=.25)),
            dict(id='right',asset=self.media[0]['asset'],start=.25,end=1,offset=None,transitionDuration=.125,
                timeRemap=dict(reverse=True,smoothing='blend',ramp=[[0,1.25,'smooth'],[2,.75,'hold']]),
                mask=dict(enabled=True,width=75,keyframes=dict(x=[[0,25],[1,65]])))]
        authored=self.author_video_edit(project,"""
            const before=videoEditTimeline(p,infos),middle=copyProject(p.videoClips[1]);
            slideVideoClip(p,infos,'middle',.125);const after=videoEditTimeline(p,infos);
            if(before.at(-1).end!==after.at(-1).end)throw Error('Total duration changed');
            if(JSON.stringify({...p.videoClips[1],offset:middle.offset})!==JSON.stringify(middle))throw Error('Center source changed');
        """)
        self.assertEqual(authored['videoClips'][2]['mask']['clockOffset'],.125)
        self.compare(authored,[0,.125,.375,.5,.625,.75,1,1.125,1.375])

    def test_authored_slide_frozen_neighbors_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            timeRemap=dict(freezeAt=.375,freezeDuration=.5)),
            dict(id='middle',asset=self.media[1]['asset'],start=0,end=.5,offset=.375,transitionDuration=.125),
            dict(id='right',asset=self.media[0]['asset'],start=.25,end=1.25,offset=.75,transitionDuration=.125,
                timeRemap=dict(freezeAt=1,freezeDuration=.75))]
        authored=self.author_video_edit(project,"slideVideoClip(p,infos,'middle',.125);")
        self.assertEqual(authored['videoClips'][0]['timeRemap']['freezeDuration'],.625)
        self.assertEqual(authored['videoClips'][2]['timeRemap']['freezeDuration'],.625)
        self.compare(authored,[0,.375,.5,.625,.875,1,1.375])

    def test_authored_slide_minimum_frozen_neighbor_keeps_three_frames_at_60fps(self):
        project=self.project();project['output']['fps']='60';project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            timeRemap=dict(freezeAt=.375,freezeDuration=.5)),
            dict(id='middle',asset=self.media[1]['asset'],start=0,end=.25,offset=.5,transitionDuration=0),
            dict(id='right',asset=self.media[0]['asset'],start=.25,end=1.25,offset=.75,transitionDuration=0,
                timeRemap=dict(freezeAt=1,freezeDuration=.75))]
        for delta,times in [(.7,[0,1.2,1.4,1.45,88/60,89/60]),(-.45,[0,1/60,2/60,.05,.3,1.45])]:
            with self.subTest(delta=delta):
                authored=self.author_video_edit(project,f"slideVideoClip(p,infos,'middle',{delta});")
                self.assertAlmostEqual(authored['videoClips'][0 if delta<0 else 2]['timeRemap']['freezeDuration'],.05)
                self.compare(authored,times)

    def test_authored_rolling_hard_cut_different_assets_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=1,offset=0,transitionDuration=0),
            dict(id='right',asset=self.media[1]['asset'],start=.5,end=1.25,offset=.75,transitionDuration=0)]
        authored=self.author_video_edit(project,"rollVideoCut(p,infos,'right',.25);")
        self.assertEqual(authored['videoClips'][0]['end'],1.25)
        self.assertEqual(authored['videoClips'][1]['start'],.75)
        self.assertEqual(authored['videoClips'][1]['offset'],1)
        self.compare(authored,[0,.25,.75,23/24,1,1.25,35/24])

    def test_authored_rolling_reverse_ramp_mask_and_overlap_match_export(self):
        project=self.project();project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=1,offset=0,transitionDuration=0,
            timeRemap=dict(reverse=True,smoothing='blend',ramp=[[0,.75,'smooth'],[2,1.5,'hold']])),
            dict(id='right',asset=self.media[1]['asset'],start=.25,end=1.25,offset=None,transitionDuration=.125,
                timeRemap=dict(reverse=True,smoothing='blend',ramp=[[0,1.25,'smooth'],[2,.75,'hold']]),
                mask=dict(enabled=True,width=75,keyframes=dict(x=[[0,25],[1,65]])))]
        authored=self.author_video_edit(project,"""
            const before=videoEditTimeline(p,infos);rollVideoCut(p,infos,'right',.125);const after=videoEditTimeline(p,infos);
            if(Math.abs(before.at(-1).end-after.at(-1).end)>1e-8)throw Error('Total duration changed');
            if(Math.abs(before[1].transition-after[1].transition)>1e-8)throw Error('Overlap changed');
        """)
        self.assertEqual(authored['videoClips'][1]['mask']['clockOffset'],.125)
        self.compare(authored,[0,.125,.375,.5,.625,.75,.875,1.125,1.375])

    def test_authored_rolling_minimum_frozen_edges_at_60fps_match_export(self):
        project=self.project();project['output']['fps']='60';project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='left',asset=self.media[0]['asset'],start=.25,end=1.25,offset=0,transitionDuration=0,
            timeRemap=dict(freezeAt=.375,freezeDuration=.5)),
            dict(id='right',asset=self.media[1]['asset'],start=.25,end=1.25,offset=.5,transitionDuration=0,
                timeRemap=dict(freezeAt=1,freezeDuration=1))]
        for delta,times in [(.95,[0,1.4,1.45,88/60,89/60]),(-.45,[0,1/60,2/60,.05,.5,1.45])]:
            with self.subTest(delta=delta):
                authored=self.author_video_edit(project,f"rollVideoCut(p,infos,'right',{delta});")
                self.assertAlmostEqual(authored['videoClips'][0 if delta<0 else 1]['timeRemap']['freezeDuration'],.05)
                self.compare(authored,times)

    def test_time_freeze_reverse_transition_and_grade_match_export(self):
        project=self.project()
        project['video'].update(linkSpeed=False,loop=False)
        project['videoClips']=[dict(id='freeze',asset=self.media[0]['asset'],start=0,end=2,offset=0,transitionDuration=0,
            timeRemap=dict(freezeAt=.625,freezeDuration=.75),color=dict(exposure=.3)),
            dict(id='reverse',asset=self.media[0]['asset'],start=.25,end=1.25,offset=.5,transitionDuration=.25,
            timeRemap=dict(reverse=True,smoothing='blend'),color=dict(temperature=-20))]
        self.compare(project,[0,.375,.5,.625,.75,1.25])

    def test_time_layer_gif_reverse_ramp_blend_and_frozen_video_match_export(self):
        project=self.project()
        project['visualLayers']=[dict(id='gif',type='video',asset=self.gif['asset'],start=0,end=1,speed=.75,
            phase=.125,offset=0,until=1.5,x=25,width=50,loop=True,
            timeRemap=dict(reverse=True,smoothing='blend',ramp=[[0,.5,'smooth'],[1,2,'linear']])),
            dict(id='freeze',type='video',asset=self.media[0]['asset'],start=.125,end=1.875,offset=.25,until=1.25,x=75,width=50,
            timeRemap=dict(freezeAt=.875,freezeDuration=.5))]
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_visual_layers_alpha_video_geometry_and_blends_match_export(self):
        project=self.project()
        project['video'].update(temperature=18,contrast=1.15,grain=3)
        project['visualLayers']=[dict(id='png',type='image',asset=self.overlay['asset'],
            offset=.25,until=1.25,width=65,x=35,y=60,opacity=73,rotation=18,blend='screen'),
            dict(id='movie',type='video',asset=self.media[1]['asset'],start=.25,end=1.5,speed=.75,
                 offset=.5,until=1.5,width=35,x=65,y=35,rotation=-25,opacity=64,blend='multiply')]
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_visual_layers_text_wrap_fonts_groups_and_time_match_export(self):
        project=self.project()
        project['visualGroups']=[dict(id='titles',visible=True,locked=True),dict(id='hidden',visible=False)]
        project['visualLayers']=[dict(id='title',type='text',group='titles',text='Sakin akşam\nİstanbul ışıkları',
            font='Montserrat',fontSize=64,width=32,x=35,y=40,rotation=12,opacity=78,textColor='#ffdca0',offset=.25,until=1),
            dict(id='caption',type='text',font='Arial',text='Birlikte akan zaman — Cozy Fi',align='left',fontSize=40,
                 width=25,x=70,y=70,blend='difference',offset=.5,until=1.5),
            dict(id='hidden',type='text',group='hidden',text='GİZLİ',fontSize=200)]
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_visual_layers_independent_video_loop_hold_and_trim_phase_match_export(self):
        project=self.project()
        project['visualLayers']=[dict(id='loop',type='video',asset=self.gif['asset'],
            offset=0,until=1.5,start=0,end=1,phase=.125,speed=1.5,width=50,x=25,y=50),
            dict(id='hold',type='video',asset=self.media[0]['asset'],
                 offset=.25,until=1.25,start=1,end=1.5,phase=.25,speed=1,loop=False,width=50,x=75,y=50)]
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_colors_film_grain_and_framing_match(self):
        project=self.project()
        project['video'].update(temperature=35, liftShadows=20, brightness=.12, contrast=1.2, gamma=1.4,
                                saturation=.65, hueShift=35, vignette=.4, grain=14, blur=1,
                                filmOverlay='lightleak', filmIntensity=45, letterbox=8, zoom=1.15,
                                start=.25,end=1,speed=.75)
        self.compare(project,[.5,1.25])

    def test_video_keyframes_transform_and_opacity_match_export(self):
        project = self.project()
        project['video'].update(cropLeft=12.5, cropRight=25, cropTop=10, cropBottom=5,
                                fit='contain', mirrorX=True, grain=5, vizType='bars',
                                keyframes=dict(zoom=[[0, .5], [1.5, 1.2]], rotation=[[0, -25], [1.5, 30]],
                                               translateX=[[0, -20], [1.5, 15]], translateY=[[0, 10], [1.5, -10]],
                                               opacity=[[0, 100], [1.5, 0]]))
        project['videoClips'] = [dict(asset=m['asset'], start=.25, end=1.25, speed=1,
                                     transition='fade', transitionDuration=.5) for m in self.media]
        project['overlay'].update(asset=self.overlay['asset'], url=self.overlay['url'], x=70, y=20)
        project['lyrics'].update(enabled=True, animation='none', font='Arial', fontSize=30,
                                 lines=[dict(id='l', text='Hareket', start=0, end=1.5)])
        self.compare(project, [0, .25, .75, 1.25])

    def test_nonlinear_video_intervals_and_hold_match_export(self):
        project = self.project()
        project['video'].update(fit='contain', mirrorX=True, cropLeft=12.5,
            keyframes=dict(zoom=[[0, .6, dict(type='ease-in')], [.75, 1.1, dict(type='ease-out')], [1.5, .7]],
                           rotation=[[0, -30, dict(type='smooth')], [1.5, 30]],
                           translateX=[[0, -10, dict(type='bezier', control=[.8, .1, .2, .9])], [1.5, 15]],
                           opacity=[[0, 100, dict(type='hold')], [.75, 40, dict(type='smooth')], [1.5, 80]]))
        project['videoClips'] = [dict(asset=m['asset'], start=.25, end=1.25, speed=1,
                                     transition='fade', transitionDuration=.5) for m in self.media]
        self.compare(project, [.25, .5, .75, 1.25])

    def test_main_montage_source_lyrics_and_visualizer_match_export(self):
        project = self.project()
        project['mainClips'] = [dict(id='a', start=1, end=1.5, offset=0),
                                dict(id='b', start=0, end=.5, offset=1)]
        project['lyrics'].update(enabled=True, animation='none', font='Arial', fontSize=35,
                                lines=[dict(id='first', text='A', start=0, end=.5),
                                       dict(id='second', text='B', start=1, end=1.5)])
        project['video'].update(vizType='bars', bassEffects=['zoom'], bassSensitivity=90)
        self.compare(project, [.25,.75,1.25])

    def test_1080p_60fps_export(self):
        project = self.project()
        # Exercise sustained frame uploads past the reported failure at frame 501.
        duration = 12
        audio = self.root / 'long-audio.wav'
        subprocess.run([self.ffmpeg, '-v', 'error', '-y', '-stream_loop', '-1',
                        '-i', str(self.audio), '-t', str(duration), str(audio)], check=True)
        project['tracks']['main']['source'].update(
            name=audio.name, size=audio.stat().st_size, duration=duration)
        project['tracks']['main']['end'] = duration
        project['output'].update(resolution='1080', fps='60')
        project['video']['grain'] = 14
        target = self.root / '1080p60.mp4'
        files = dict(main=str(audio), background=media_assets.source_path(project['background']['asset']))
        ok, message = engine.process_and_render(project, files, str(target))
        self.assertTrue(ok, message)
        info = media_assets.probe(target, self.ffmpeg)
        self.assertEqual((info['width'], info['height']), (1920, 1080))
        self.assertAlmostEqual(info['fps'], 60)
        self.assertAlmostEqual(info['duration'], duration, delta=.05)
        decoded = subprocess.run([self.ffmpeg, '-v', 'error', '-xerror', '-i', str(target),
                                  '-progress', 'pipe:1', '-f', 'null', '-'],
                                 check=True, capture_output=True, text=True)
        counts = [int(line.partition('=')[2]) for line in decoded.stdout.splitlines()
                  if line.startswith('frame=')]
        self.assertEqual(counts[-1], duration*60)

    def test_visualizer_and_layers_match_at_seeked_times(self):
        project=self.project()
        project['video'].update(vizType='radial',vizTheme='gold_amber',vizScale=65,
                                bassEffects=['zoom','rgb_split','glow'],bassSensitivity=75)
        project['overlay'].update(asset=self.overlay['asset'],url=self.overlay['url'],x=70,y=20,scale=200)
        project['lyrics'].update(fontSize=70,glowIntensity=30,template='karaoke',boxStyle='pill',
                                 animation='slide',bassEffects=['pulse','color_flash','wave_float','tilt_shake'],
                                 lines=[dict(id='one',text='Sakin akşam',start=0,end=.75),
                                        dict(id='two',text='Yumuşak geçiş',start=.75,end=1.5)])
        self.compare(project,[.5,.75,.875,1.25])

    def test_cancelled_batch_does_not_publish_video(self):
        project = self.project()
        cancel = threading.Event()
        target = self.root / 'cancelled.mp4'
        files = dict(main=str(self.audio), background=media_assets.source_path(project['background']['asset']))
        def progress(percent, _message):
            if percent >= 63:
                cancel.set()
        ok, _message = engine.process_and_render(project, files, str(target), progress=progress, cancel=cancel)
        self.assertFalse(ok)
        self.assertFalse(target.exists())
        self.assertFalse(Path(str(target) + '.partial.mp4').exists())

    def test_multi_clip_transition_and_portrait_match(self):
        project=self.project()
        project['videoClips']=[dict(asset=m['asset'],start=.25,end=1.25,speed=1,transition='fade',transitionDuration=.5) for m in self.media]
        project['output']['aspect']='9:16'
        self.compare(project,[.25,.75,1.25])

    def test_word_highlight_and_line_crossfade_match(self):
        project = self.project()
        project['lyrics'].update(template='word-by-word', animation='pop', fontSize=64,
                                 lines=[dict(id='one',text='Soft words',start=0,end=.75),
                                        dict(id='two',text='Flow together',start=.75,end=1.5)])
        self.compare(project, [.125, .5, .875, 1.25])

    def test_project_lyric_words_in_main_gap_match_export(self):
        project=self.project()
        project['mainClips']=[dict(id='left',start=0,end=.5,offset=0),dict(id='right',start=1,end=1.5,offset=1)]
        project['lyrics'].update(timeBase='project',template='word-by-word',animation='fade',
            lines=[dict(id='gap',text='Gap words',start=.5,end=1,words=[dict(text='Gap',start=.5,end=.7),dict(text='words',start=.8,end=1)])])
        self.compare(project,[.25,.625,.875,1.25])

    def test_explicit_clip_gaps_match_black_preview_and_output(self):
        project = self.project()
        project['videoClips'] = [dict(asset=self.media[0]['asset'], id='one', offset=.25, start=0, end=.5, transitionDuration=0),
                                 dict(asset=self.media[1]['asset'], id='two', offset=1, start=0, end=.5, transitionDuration=0)]
        self.compare(project, [.125, .5, .875, 1.25])

    def test_rotation_and_mirrors_match_preview_and_output(self):
        project = self.project()
        project['video'].update(rotation=37.5, mirrorX=True, mirrorY=True, fit='contain')
        self.compare(project, [.25, 1.25])

    def test_crop_translation_and_rotation_match_preview_and_output(self):
        project = self.project()
        project['video'].update(cropLeft=12.5, cropRight=25, cropTop=10, cropBottom=5,
                                translateX=12.5, translateY=-10, rotation=-17.5, zoom=.75, fit='contain', mirrorX=True)
        project['videoClips'] = [dict(asset=m['asset'], start=.25, end=1.25, speed=1, transition='fade', transitionDuration=.5) for m in self.media]
        self.compare(project, [.25, .75, 1.25])


    def test_per_clip_grades_curves_transition_and_global_effects_match_export(self):
        project=self.project()
        project['video'].update(linkSpeed=False,loop=False,contrast=1.1,temperature=12,
            rotation=-12,cropLeft=10,cropTop=5,fit='contain',zoom=.9)
        project['videoClips']=[dict(id=str(i),asset=m['asset'],start=.25,end=1.25,speed=1,
            transition='blur',transitionDuration=.5,transitionSoftness=65,
            color=dict(exposure=.35 if i==0 else -.25,temperature=25 if i==0 else -30,
                tint=-12,shadows=12,midtones=-8,highlights=5,gamma=1.2,saturation=.75,
                curves=dict(rgb=[[0,.05],[.45,.55],[1,.95]],red=[[0,.02],[1,.9]])))
            for i,m in enumerate(self.media)]
        self.compare(project,[.25,.5,.625,.75,.875,1.25])

    def test_single_background_grade_custom_rgb_curves_match_export(self):
        project=self.project()
        project['video']['color']=dict(exposure=-.4,brightness=.04,contrast=1.15,
            temperature=-22,tint=15,shadows=18,midtones=-12,highlights=-8,gamma=.7,saturation=1.3,
            curves=dict(rgb=[[0,.05],[.2,.15],[.6,.8],[1,.9]],red=[[0,.1],[1,.8]],
                        green=[[0,0],[.45,.55],[1,1]],blue=[[0,.1],[1,.9]]))
        self.compare(project,[0,.25,.5,.75,1,1.25])

    def test_new_transition_zoom_and_blur_match_export(self):
        for effect, direction in [('zoom', 'out'), ('blur', 'left')]:
            with self.subTest(effect=effect):
                project = self.project()
                project['video'].update(linkSpeed=False, loop=False)
                project['videoClips'] = [dict(asset=m['asset'], start=.25, end=1.25, speed=1,
                    transition=effect, transitionDuration=.5, transitionDirection=direction,
                    transitionSoftness=85) for m in self.media]
                self.compare(project, [.5, .625, .75, .875, 1, 1.25])

    def test_directional_transition_wipe_slide_and_circle_match_export(self):
        for effect, direction in [('wipeleft', 'right'), ('slideleft', 'up'), ('circlecrop', 'out')]:
            with self.subTest(effect=effect):
                project = self.project()
                project['video'].update(linkSpeed=False, loop=False)
                project['videoClips'] = [dict(asset=m['asset'], start=.25, end=1.25, speed=1,
                    transition=effect, transitionDuration=.5, transitionDirection=direction,
                    transitionSoftness=50) for m in self.media]
                self.compare(project, [.5, .625, .75, .875, 1.25])

if __name__ == '__main__':
    unittest.main()
