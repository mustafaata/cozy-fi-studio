"""Production boundaries found in the October audit: real files and owned workers."""
import io
import json
import multiprocessing
import os
import subprocess
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from flask import Flask
import numpy as np
from pedalboard.io import AudioFile

import audit_worker_fixture
from isolated_task import run_isolated
from media_operations import MediaOperations
from project import SCHEMA, validate_project
from project_package import build_package, unpack_package
from sample_api import sample_bounds
from security import public_error
from temporary_media import TemporaryMedia
from worker_lifecycle import start_worker


def make_project():
    return validate_project(dict(version=1,effects=dict(speed=1,reverb=0),tracks=dict(main=dict(
        source=dict(name='main.wav',size=100,lastModified=0,duration=20)))))


def running(pid):
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=kernel.OpenProcess(0x1000,False,pid)
        if not handle:return False
        try:
            code=wintypes.DWORD()
            return bool(kernel.GetExitCodeProcess(handle,ctypes.byref(code))) and code.value==259
        finally:kernel.CloseHandle(handle)
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False


class AuditBoundaryTests(unittest.TestCase):
    def test_main_reverb_impulse_matches_javascript_at_44_and_48_khz(self):
        import engine
        script="""const fs=require('node:fs'),vm=require('node:vm');const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')}),addEventListener(){}}});for(const name of ['project','audio'])vm.runInContext(fs.readFileSync('static/js/'+name+'.js','utf8'),c);process.stdout.write(vm.runInContext(`JSON.stringify([44100,48000].map(sampleRate=>{const audioCtx={sampleRate,createBuffer:(channels,length,rate)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i]};}},impulse=AudioEngine.prototype.buildImpulse.call({audioCtx},2.5);return [0,1].map(i=>Array.from(impulse.getChannelData(i).slice(0,32)));}))`,c));"""
        response=subprocess.run(['node','-e',script],capture_output=True,text=True,check=True)
        for rate,actual in zip((44100,48000),json.loads(response.stdout)):
            np.testing.assert_allclose(actual,engine._get_convolver_impulse(rate)[:,:32],atol=1e-9)

    def test_exception_diagnostic_never_records_secret_or_traceback(self):
        with self.assertLogs('security',level='WARNING') as capture:
            message=public_error(RuntimeError('https://example.test/?api_key=AUDIT_SENTINEL'))
        self.assertNotIn('AUDIT_SENTINEL',message+' '.join(capture.output))
        self.assertIn('RuntimeError',' '.join(capture.output))
        self.assertIsNone(capture.records[0].exc_info)

    def test_track_limit_includes_default_channels(self):
        tracks={'main':{},**{f'extra{i}':{} for i in range(SCHEMA['limits']['tracks']-1)}}
        with self.assertRaises(ValueError):validate_project(dict(version=1,tracks=tracks))

    def test_reserved_media_and_dom_names_are_rejected(self):
        for identifier in ('camera_000','lyrics','output','videofx','yt'):
            with self.subTest(identifier=identifier),self.assertRaises(ValueError):
                validate_project(dict(version=1,tracks={'main':{},identifier:{}}))

    def test_case_distinct_archive_members_remain_distinct_on_windows(self):
        p=make_project();p['tracks']['MAIN']=p['tracks']['main'].copy();p=validate_project(p)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);a=root/'first.wav';b=root/'second.wav';a.write_bytes(b'a'*100);b.write_bytes(b'b'*100)
            package=io.BytesIO();build_package(package,p,{'media/main':a,'media/MAIN':b});package.seek(0)
            opened,files=unpack_package(package,root)
            self.assertEqual(opened,p)
            self.assertNotEqual(files['media/main'].casefold(),files['media/MAIN'].casefold())
            self.assertEqual(Path(files['media/main']).read_bytes(),b'a'*100)
            self.assertEqual(Path(files['media/MAIN']).read_bytes(),b'b'*100)

    def test_large_lut_archive_roundtrips_under_shared_json_limit(self):
        p=make_project();p['luts']=[dict(id='cube',name='Cube',size=33,data=[.12345678901234567]*(33**3*3))]
        p=validate_project(p)
        self.assertGreater(len(json.dumps(p)),2*1024*1024)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);audio=root/'audio';audio.write_bytes(b'a'*100);package=io.BytesIO()
            build_package(package,p,{'media/main':audio});package.seek(0)
            self.assertEqual(unpack_package(package,root)[0],p)

    def test_sample_uses_montage_duration_including_gaps(self):
        p=make_project();p['mainClips']=[dict(id='later',start=0,end=5,offset=30)];p=validate_project(p)
        self.assertEqual(sample_bounds(p,25,5),(25,30))
        with self.assertRaises(ValueError):sample_bounds(p,31,5)

    def test_actual_audio_duration_is_checked_before_decode(self):
        from audio_render import read_clip
        import engine
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.wav'
            with AudioFile(str(path),'w',44100,2) as output:output.write(np.zeros((2,44100),np.float32))
            with patch('audio_render.run_ffmpeg') as decode,self.assertRaises(ValueError):
                read_clip(str(path),dict(start=0,end=None,source=dict(duration=.1)),folder,engine._ffmpeg_bin())
            decode.assert_not_called()

    def test_thread_start_failure_returns_lease_and_rolls_back(self):
        slot=threading.BoundedSemaphore(1);slot.acquire();rollback=[]
        with patch('worker_lifecycle.threading.Thread.start',side_effect=RuntimeError('cannot start')):
            with self.assertRaises(RuntimeError):start_worker(lambda:None,slot,lambda:rollback.append(True))
        self.assertEqual(rollback,[True]);self.assertTrue(slot.acquire(blocking=False));slot.release()

    def test_temp_transfer_survives_delete_until_every_reader_closes(self):
        app=Flask(__name__);media=TemporaryMedia('audit_transfer_');path=Path(media.name)/'audio.wav';path.write_bytes(b'audio')
        with app.test_request_context('/'):
            first=media.send(path);second=media.send(path)
            media.cleanup();self.assertTrue(path.exists())
            first.close();first.close();self.assertEqual(media.readers,1);self.assertTrue(path.exists())
            second.close();self.assertEqual(media.readers,0);self.assertFalse(path.exists())
        media.cleanup()

    def test_cancel_before_upload_registration_is_not_lost(self):
        import uuid
        operations=MediaOperations();identifier=uuid.uuid4().hex
        self.assertEqual(operations.cancel(identifier)[1],204)
        with self.assertRaisesRegex(ValueError,'iptal'):
            with operations.operation(identifier):self.fail('cancelled operation started')
        self.assertNotIn(identifier,operations.entries)

    def test_isolated_worker_returns_and_leaves_no_active_child(self):
        before={child.pid for child in multiprocessing.active_children()}
        self.assertEqual(run_isolated(audit_worker_fixture.echo,('result',),timeout=5),'result')
        self.assertEqual({child.pid for child in multiprocessing.active_children()},before)

    def test_absolute_deadline_terminates_blocked_worker(self):
        start=time.monotonic()
        with self.assertRaisesRegex(ValueError,'süre sınırı'):
            run_isolated(audit_worker_fixture.blocked,timeout=1)
        self.assertLess(time.monotonic()-start,5)

    def test_cancel_terminates_native_descendant_as_well_as_worker(self):
        cancel=threading.Event()
        with tempfile.TemporaryDirectory() as folder:
            marker=Path(folder)/'child.pid'
            def cancel_started():
                deadline=time.monotonic()+8
                while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
                cancel.set()
            watcher=threading.Thread(target=cancel_started,daemon=True);watcher.start()
            with self.assertRaisesRegex(ValueError,'iptal'):
                run_isolated(audit_worker_fixture.spawn_descendant,(str(marker),),cancel,timeout=12)
            watcher.join(1);self.assertTrue(marker.exists(),'child fixture did not start')
            self.assertFalse(running(int(marker.read_text(encoding='ascii'))),'owned descendant remained alive')
