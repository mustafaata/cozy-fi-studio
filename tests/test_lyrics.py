import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from pedalboard.io import AudioFile

import app
import engine
from lyrics import project_cues, validate_lines, wrap_text, write_ass
from project import SCHEMA, TRACK_IDS, validate_project
from transcription_worker import segment_lines
from video_render import render_video


def project():
    p = validate_project(dict(version=1, tracks={k:{} for k in TRACK_IDS}))
    p["effects"]["speed"] = 1
    p["tracks"]["main"].update(start=.5, end=1.5, source=dict(name="song.wav", size=1, lastModified=0, duration=2))
    p["lyrics"]["fontSize"] = 60
    p["lyrics"]["lines"] = [dict(id="a", text="İçimde ışık", start=.2, end=.7), dict(id="b", text="Şarkı sözü\nİkinci satır", start=1, end=1.3)]
    return validate_project(p)


class LyricTests(unittest.TestCase):
    def test_project_clock_cues_ignore_source_speed_and_render_in_montage_gaps(self):
        p=project()
        p['effects']['speed']=1.5
        p['mainClips']=[dict(id='one',start=0,end=.75,offset=0),dict(id='two',start=1,end=1.75,offset=1.5)]
        p['lyrics'].update(timeBase='project',offset=.1,lines=[dict(id='gap',text='In the gap',start=.7,end=1.2),dict(id='last',text='Tail',start=1.8,end=3)])
        p=validate_project(p)
        cues=project_cues(p,2)
        self.assertAlmostEqual(cues[0]['start'],.8)
        self.assertAlmostEqual(cues[0]['end'],1.3)
        self.assertEqual(cues[1]['end'],2)
        p['lyrics']['enabled']=False
        self.assertEqual(project_cues(p,2),[])

    def test_contract_and_cut_speed_offset(self):
        p = project()
        for speed in (.5, 1, 1.5):
            p["effects"]["speed"] = speed
            cues = project_cues(p, 1/speed)
            self.assertEqual(cues[0]["start"], 0)
            self.assertAlmostEqual(cues[0]["end"], .2/speed)
            self.assertAlmostEqual(cues[1]["start"], .5/speed)
        p["lyrics"]["offset"] = .1
        self.assertAlmostEqual(project_cues(p, 1)[0]["end"], .3/1.5)
        p["lyrics"]["enabled"] = False
        self.assertEqual(project_cues(p, 1), [])
        p = project()
        p["lyrics"]["lines"][1]["start"] = .6
        with self.assertRaises(ValueError):
            validate_project(p)
        for color in ("red", "#ffff", "#ffffff\\pos(0,0)"):
            p = project()
            p["lyrics"]["color"] = color
            with self.assertRaises(ValueError):
                validate_project(p)

    def test_untimed_and_invalid_lines(self):
        p = project()
        p["lyrics"]["lines"] = [dict(id="new", text="Zamansız", start=None, end=None)]
        self.assertEqual(project_cues(validate_project(p), 1), [])
        for update in (dict(start=float("nan"), end=5), dict(start=0, end=None), dict(confidence=2), dict(text=""), dict(review="true")):
            line = dict(id="x", text="Text", start=1, end=2)
            line.update(update)
            with self.assertRaises(ValueError):
                validate_lines([line], SCHEMA["lyricLimits"])

    def test_ass_escaping_and_multiline_layout(self):
        p = project()
        p["lyrics"]["lines"][0]["text"] = "İstanbul {\\pos(0,0)}\nışıklar"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lyrics.ass"
            self.assertTrue(write_ass(p, 320, 180, 1, path))
            text = path.read_text(encoding="utf-8-sig")
            self.assertIn("İstanbul", text)
            self.assertIn("｛＼pos(0,0)｝", text)
            self.assertNotIn("{\\pos(0,0)}", text)
            self.assertIn("\\N", text)
            self.assertIn("0:00:00.00,0:00:00.20", text)
        lines = wrap_text("İstanbul gecelerinde ışıklar yanar.\nİkinci satır", p["lyrics"], 180, 320)
        self.assertGreaterEqual(len(lines), 3)

    def test_auto_confidence_and_silence_rejection(self):
        segment = SimpleNamespace(no_speech_prob=.1, compression_ratio=1, avg_logprob=-.3, start=0, end=2,
                                  text="Merhaba dünya", words=[SimpleNamespace(start=0,end=1,word="Merhaba",probability=.6), SimpleNamespace(start=1,end=2,word=" dünya",probability=.8)])
        rows = segment_lines(segment, 3, 1)
        self.assertEqual(rows[0]["text"], "Merhaba dünya")
        self.assertTrue(rows[0]["review"])
        segment.no_speech_prob = np.float32(.6)
        json.dumps(segment_lines(segment, 3, 1))
        segment.no_speech_prob=.9
        self.assertTrue(segment_lines(segment, 3, 1)[0]['review'])
        segment.no_speech_prob=.1
        segment.compression_ratio=4
        self.assertTrue(segment_lines(segment, 3, 1)[0]['review'])
        segment.no_speech_prob=.99
        segment.avg_logprob=-2
        self.assertEqual(segment_lines(segment, 3, 1), [])


class LyricIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.ffmpeg = engine._ffmpeg_bin()
        cls.video, cls.audio = cls.root / "background.mp4", cls.root / "song.wav"
        subprocess.run([cls.ffmpeg,"-y","-v","error","-f","lavfi","-i","color=black:s=320x180:r=60:d=1","-c:v","libx264",str(cls.video)],check=True)
        with AudioFile(str(cls.audio),"w",16000,1) as handle:
            handle.write(np.zeros((1,32000),np.float32))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_burned_turkish_lyrics_follow_frame_times(self):
        for fps in (24,30,60):
            p=project()
            # This test measures cue boundaries independently of the default fade.
            p["lyrics"]["animation"]="none"
            p["output"]["fps"]=str(fps)
            dest=str(self.root/f"lyrics-{fps}.mp4")
            render_video(p,str(self.video),str(self.audio),dest,str(self.root),self.ffmpeg,1,lambda *_:None)
            result=subprocess.run([self.ffmpeg,"-v","error","-i",dest,"-an","-f","rawvideo","-pix_fmt","gray","-"],capture_output=True,check=True)
            frames=np.frombuffer(result.stdout,np.uint8).reshape(-1,180,320)
            visible=(frames>80).sum(axis=(1,2))>5
            self.assertEqual(len(frames),fps)
            expected=np.array([t<.2-1e-8 or .5-1e-8<=t<.8-1e-8 for t in np.arange(fps)/fps])
            self.assertLessEqual(int(np.count_nonzero(visible!=expected)),1)

    def test_job_offsets_and_single_slot(self):
        started=threading.Event()
        release=threading.Event()
        def recognize(*args):
            started.set()
            release.wait(2)
            return dict(lines=[dict(id="a",text="İlk satır",start=.1,end=.5,
                words=[dict(text='İlk',start=.1,end=.25),dict(text='satır',start=.3,end=.5)])],language="tr")
        client=app.app.test_client()
        def data():
            return dict(file=(io.BytesIO(self.audio.read_bytes()),"song.wav"),start=".5",end="1.5",model="base",language="tr")
        with patch("transcription.run_transcription",side_effect=recognize):
            response=client.post('/api/lyrics/transcribe',data=data())
            self.assertEqual(response.status_code,202)
            job=response.get_json()["job_id"]
            self.assertTrue(started.wait(2))
            self.assertEqual(client.post('/api/lyrics/transcribe',data=data()).status_code,429)
            release.set()
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                result=client.get('/api/lyrics/jobs/'+job).get_json()
                if result['state']!='running':break
                time.sleep(.02)
            self.assertEqual(result['state'],'done',result)
            self.assertEqual(result['result']['lines'][0]['start'],.6)
            self.assertEqual(result['result']['lines'][0]['end'],1)
            self.assertEqual(result['result']['lines'][0]['words'],[
                dict(text='İlk',start=.6,end=.75),dict(text='satır',start=.8,end=1)])
        self.assertEqual(client.post('/api/lyrics/jobs/missing/cancel').status_code,404)
        bad=data();bad['model']='../../model'
        self.assertEqual(client.post('/api/lyrics/transcribe',data=bad).status_code,400)

    def test_reference_range_decodes_only_crop_and_restores_source_times(self):
        from lyric_alignment import align_reference
        seen = {}
        def recognize(source, work, model, language, cancel, report):
            with AudioFile(source) as audio:
                seen['duration'] = audio.frames / audio.samplerate
            reference = json.loads((Path(work) / 'reference.json').read_text(encoding='utf-8'))
            seen['reference'] = reference
            words = [dict(word='Yeni', start=.1, end=.3, probability=.9),
                     dict(word='söz', start=.3, end=.5, probability=.9)]
            return dict(lines=align_reference(reference, words, seen['duration']), language='tr')
        client = app.app.test_client()
        reference = [dict(id='selected', text='Yeni söz', start=None, end=None)]
        def data(ref=reference, scope='range'):
            return dict(file=(io.BytesIO(self.audio.read_bytes()), 'song.wav'), start='.5', end='1.5',
                        reference=json.dumps(ref), referenceScope=scope, model='large-v3-turbo', language='tr')
        with patch('transcription.run_transcription', side_effect=recognize):
            response = client.post('/api/lyrics/transcribe', data=data())
            self.assertEqual(response.status_code, 202, response.get_json())
            job = response.get_json()['job_id']
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                result = client.get('/api/lyrics/jobs/' + job).get_json()
                if result['state'] != 'running': break
                time.sleep(.02)
            self.assertEqual(result['state'], 'done', result)
            self.assertAlmostEqual(seen['duration'], 1, places=3)
            self.assertEqual(len(seen['reference']), 1)
            self.assertIsNone(seen['reference'][0]['start'])
            cue = result['result']['lines'][0]
            self.assertEqual(cue['text'], 'Yeni söz')
            self.assertEqual((cue['start'], cue['end']), (.6, 1))
            self.assertTrue(cue['review'])
        self.assertEqual(client.post('/api/lyrics/transcribe', data=data(scope='full')).status_code, 400)
        self.assertEqual(client.post('/api/lyrics/transcribe', data=data(scope='invalid')).status_code, 400)
        self.assertEqual(client.post('/api/lyrics/transcribe', data=data([dict(reference[0], start=.6, end=1)])).status_code, 400)

    def test_cancel_does_not_publish_draft(self):
        started=threading.Event()
        def recognize(source,work,model,lang,cancel,report):
            started.set()
            cancel.wait(2)
            return dict(lines=[],language="tr")
        client=app.app.test_client()
        with patch("transcription.run_transcription",side_effect=recognize):
            response=client.post('/api/lyrics/transcribe',data=dict(file=(io.BytesIO(self.audio.read_bytes()),'song.wav'),start=0,end=1))
            job=response.get_json()['job_id'];self.assertTrue(started.wait(2))
            self.assertEqual(client.post('/api/lyrics/jobs/'+job+'/cancel').status_code,200)
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                result=client.get('/api/lyrics/jobs/'+job).get_json()
                if result['state']=='cancelled':break
                time.sleep(.02)
            self.assertEqual(result['state'],'cancelled')
            self.assertNotIn('result',result)

    def test_modern_edit_fonts_and_beat_synced_effects(self):
        from lyrics import apply_text_transform
        self.assertEqual(apply_text_transform("istanbul ışık", "uppercase"), "İSTANBUL IŞIK")
        self.assertEqual(apply_text_transform("İSTANBUL IŞIK", "lowercase"), "istanbul ışık")

        fonts = ["Montserrat", "Bebas Neue", "Poppins", "Anton", "Cinzel", "Playfair Display", "Righteous", "Syne", "Caveat", "Outfit"]
        effects = ["pulse", "bounce", "glow", "glitch"]
        for i, font in enumerate(fonts):
            p = project()
            p["lyrics"]["font"] = font
            p["lyrics"]["bassEffect"] = effects[i % len(effects)]
            p["lyrics"]["bassIntensity"] = 75
            p["lyrics"]["letterSpacing"] = 2
            p["lyrics"]["glowColor"] = "#ff007f"
            p["lyrics"]["glowIntensity"] = 60
            p["lyrics"]["outlineColor"] = "#00ffff"
            p["lyrics"]["textTransform"] = "uppercase"
            p["lyrics"]["animation"] = "pop"
            with tempfile.TemporaryDirectory() as tmp:
                ass_path = Path(tmp) / "test.ass"
                beats = [0.3, 0.6, 1.1]
                self.assertTrue(write_ass(p, 640, 360, 1.5, ass_path, beats=beats))
                content = ass_path.read_text(encoding="utf-8-sig")
                self.assertIn(font, content)
                self.assertIn("İÇİMDE IŞIK", content)
                self.assertIn("\\fsp2", content)
                self.assertIn("\\t(", content)

    def test_karaoke_template_and_pill_box(self):
        p = project()
        p["lyrics"]["template"] = "karaoke"
        p["lyrics"]["boxStyle"] = "pill"
        p["lyrics"]["glowColor"] = "#00ffff"
        p["lyrics"]["background"] = "#000000"
        p["lyrics"]["backgroundOpacity"] = 0.5
        with tempfile.TemporaryDirectory() as tmp:
            ass_path = Path(tmp) / "karaoke.ass"
            self.assertTrue(write_ass(p, 640, 360, 2.0, ass_path))
            content = ass_path.read_text(encoding="utf-8-sig")
            # Verify ASS karaoke \kf tags and soft pill blur
            self.assertIn("\\kf", content)
            self.assertIn("\\blur3", content)
            self.assertIn(ass_path.name, ass_path.name)
            # Verify FFmpeg parses it without syntax error
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x180:d=0.5",
                   "-vf", f"ass={ass_path.name}", "-f", "null", "-"]
            subprocess.run(cmd, cwd=tmp, check=True)

    def test_multi_bass_effects_in_ass(self):
        p = project()
        p["lyrics"]["bassEffects"] = ["bounce", "glow"]
        p["lyrics"]["glowColor"] = "#ff007f"
        p["lyrics"]["bassIntensity"] = 80
        with tempfile.TemporaryDirectory() as tmp:
            ass_path = Path(tmp) / "multi_fx.ass"
            beats = [0.3, 0.6]
            self.assertTrue(write_ass(p, 640, 360, 1.5, ass_path, beats=beats))
            content = ass_path.read_text(encoding="utf-8-sig")
            # Both bounce (\fscy) and glow (\blur & \3c) tags present for beat hits
            self.assertIn("\\fscy", content)
            self.assertIn("\\blur", content)
            self.assertIn("&h007f00ff", content.lower())
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x180:d=0.5",
                   "-vf", f"ass={ass_path.name}", "-f", "null", "-"]
            subprocess.run(cmd, cwd=tmp, check=True)

    def test_word_by_word_and_auto_fit(self):
        p = project()
        p["lyrics"]["template"] = "word-by-word"
        p["lyrics"]["autoFit"] = True
        p["lyrics"]["glowColor"] = "#00e5ff"
        p["lyrics"]["lines"][0]["text"] = "This is a super energetic word by word test with a very long sentence that exceeds line width easily"
        with tempfile.TemporaryDirectory() as tmp:
            ass_path = Path(tmp) / "word_by_word.ass"
            self.assertTrue(write_ass(p, 640, 360, 2.0, ass_path))
            content = ass_path.read_text(encoding="utf-8-sig")
            # Verify word pop scaling tags and downsized \fs tag
            self.assertIn("\\fscx122\\fscy122", content)
            self.assertIn("\\fs", content)
            # Verify FFmpeg parses it without error
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x180:d=0.5",
                   "-vf", f"ass={ass_path.name}", "-f", "null", "-"]
            subprocess.run(cmd, cwd=tmp, check=True)

    def test_new_fonts_and_all_beat_effects(self):
        p = project()
        for font in ["Orbitron", "Permanent Marker", "Space Grotesk", "Monoton"]:
            p["lyrics"]["font"] = font
            p["lyrics"]["bassEffects"] = ["wave_float", "color_flash", "tilt_shake", "blur_pulse"]
            p["lyrics"]["glowColor"] = "#ff00aa"
            with tempfile.TemporaryDirectory() as tmp:
                ass_path = Path(tmp) / f"{font.replace(' ', '_')}.ass"
                beats = [0.05, 0.60]
                self.assertTrue(write_ass(p, 640, 360, 1.0, ass_path, beats=beats))
                content = ass_path.read_text(encoding="utf-8-sig")
                self.assertIn(font, content)
                self.assertIn("\\frz", content)
                self.assertIn("\\blur", content)
                cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x180:d=0.5",
                       "-vf", f"ass={ass_path.name}", "-f", "null", "-"]
                subprocess.run(cmd, cwd=tmp, check=True)


if __name__=='__main__':
    unittest.main()
