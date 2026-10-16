import json
from pathlib import Path
import shutil
import subprocess
import unittest

import numpy as np

from audio_render import SAMPLE_RATE, track_block
from parameter_curves import curve_values
from project import SCHEMA, validate_project


class ParameterCurveTests(unittest.TestCase):
    def test_known_shapes_and_exact_hold_boundaries(self):
        for kind, expected in [('linear', .25), ('ease-in', .0625), ('ease-out', .4375), ('smooth', .15625), ('hold', 0)]:
            points = [[0, 0, dict(type=kind)], [4, 100]]
            np.testing.assert_allclose(curve_values(points, [-1, 1, 4, 5], 0), [0, 100*expected, 100, 100])
        np.testing.assert_allclose(curve_values([[0, 0, dict(type='bezier', control=[0, 1/3, 0, 2/3])], [1, 1]], [.125], 0), [.5])

    def test_server_validation_for_audio_and_video(self):
        for kind in SCHEMA['curveTypes']:
            descriptor = dict(type=kind, **({'control': SCHEMA['curveDefaultBezier']} if kind == 'bezier' else {}))
            p = dict(version=1, tracks={'main': {'automation': {'volume': [[0, 10, descriptor], [1, 100]]}}},
                     video={'keyframes': {'zoom': [[0, 1, descriptor], [1, 2]]}})
            self.assertEqual(validate_project(p)['video']['keyframes']['zoom'][0][2], descriptor)
        for bad in [None, [], {}, dict(type='unknown'), dict(type='linear', control=[0, 0, 1, 1]), dict(type='bezier'),
                    dict(type='bezier', control=[0, 0, 1, 2]), dict(type='bezier', control=[0, True, 1, 1]),
                    dict(type='smooth', domain=[.5, .5]), dict(type='smooth', domain=[0, float('nan')]), dict(type='smooth', other=1)]:
            for section in ['audio', 'video']:
                with self.subTest(bad=bad, section=section), self.assertRaises(ValueError):
                    validate_project(dict(version=1, tracks={'main': {'automation': {'volume': [[0, 10, bad]]}}} if section == 'audio' else {'main': {}},
                                          video={'keyframes': {'zoom': [[0, 1, bad]]}} if section == 'video' else {}))

    @unittest.skipUnless(shutil.which('node'), 'Node required for cross-runtime parity.')
    def test_browser_export_parity_with_domains_and_extreme_handles(self):
        root = Path(__file__).resolve().parents[1]
        cases = []
        for kind in SCHEMA['curveTypes']:
            for domain in [None, [.1, .7], [.9, 1]]:
                for control in [SCHEMA['curveDefaultBezier'], [0, 1, 0, 1], [1, 1, 0, 0]]:
                    descriptor = dict(type=kind)
                    if kind == 'bezier':
                        descriptor['control'] = control
                    if domain:
                        descriptor['domain'] = domain
                    cases.append([[.123, 10, descriptor], [2.83, 170, dict(type='hold')], [3, 20]])
        times = np.unique(np.concatenate((np.linspace(0, 4, 401), [.123, 2.83, 3]))).tolist()
        script = """const fs=require('fs'),vm=require('vm');const c=vm.createContext({});
          vm.runInContext(fs.readFileSync('static/js/parameter-curves.js','utf8'),c);
          const input=JSON.parse(fs.readFileSync(0,'utf8'));c.cases=input.cases;c.times=input.times;
          process.stdout.write(vm.runInContext('JSON.stringify(cases.map(points=>times.map(time=>curveValue(points,time,100))))',c));"""
        output = subprocess.run(['node', '-e', script], input=json.dumps(dict(cases=cases, times=times)), text=True, capture_output=True, check=True, cwd=root)
        for points, values in zip(cases, json.loads(output.stdout)):
            np.testing.assert_allclose(curve_values(points, times, 100), values, atol=1e-8, rtol=1e-8)

    @unittest.skipUnless(shutil.which('node'), 'Node required for authored-curve parity.')
    def test_pencil_and_clipboard_curves_validate_and_match_export_mixer(self):
        root = Path(__file__).resolve().parents[1]
        script = """const fs=require('fs'),vm=require('vm');
          const schema=fs.readFileSync('static/project-schema.json','utf8');
          const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:schema})}});
          for(const file of ['project','parameter-curves','automation-editing'])
            vm.runInContext(fs.readFileSync('static/js/'+file+'.js','utf8'),c);
          process.stdout.write(vm.runInContext(`
            const p=validateProject({version:1,effects:{speed:1},tracks:{main:{fadeIn:0,fadeOut:0,
              source:{name:'a',size:1,lastModified:0,duration:5}}}});
            const original=[[0,20,{type:'bezier',control:[.8,.1,.2,.9]}],[5,180]];
            const drawn=drawAutomationStroke(original,[[1,40],[1.5,150],[2,70]],5,100);
            const copied=copyAutomationPoints(drawn.points,drawn.selection);
            const pasted=pasteAutomationPoints(drawn.points,copied,3,5);
            p.tracks.main.automation.volume=pasted.points;
            const times=[.5,.9999,1,1.25,1.5,1.9999,2,2.0001,2.5,3,3.5,4,4.5].map(t=>Math.round(t*44100)/44100);
            JSON.stringify({project:validateProject(p),times,values:times.map(t=>curveValue(pasted.points,t,100))});
          `,c));"""
        output = subprocess.run(['node', '-e', script], text=True, capture_output=True, check=True, cwd=root)
        authored = json.loads(output.stdout)
        project = validate_project(authored['project'])
        track = project['tracks']['main']
        self.assertEqual(track['automation'], authored['project']['tracks']['main']['automation'])
        np.testing.assert_allclose(curve_values(track['automation']['volume'], authored['times'], 100), authored['values'], atol=1e-7)
        frames = 5*SAMPLE_RATE
        mixed = track_block(np.ones((2, frames), dtype=np.float32), track, frames, 0, frames, main=True)
        for time, value in zip(authored['times'], authored['values']):
            np.testing.assert_allclose(mixed[:, round(time*SAMPLE_RATE)], value/100, atol=1e-6)

    @unittest.skipUnless(shutil.which('node'), 'Node required for live-take parity.')
    def test_live_touch_and_latch_takes_match_export_audio(self):
        root = Path(__file__).resolve().parents[1]
        script = """const fs=require('fs'),vm=require('vm');
          const schema=fs.readFileSync('static/project-schema.json','utf8');
          const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:schema})}});
          for(const file of ['project','parameter-curves','automation-editing','automation-recording'])
            vm.runInContext(fs.readFileSync('static/js/'+file+'.js','utf8'),c);
          process.stdout.write(vm.runInContext(`JSON.stringify(['touch','latch'].map(mode=>{
            const p=validateProject({version:1,effects:{speed:1},tracks:{main:{fadeIn:.4,fadeOut:.6,
              source:{name:'recorded',size:1,lastModified:0,duration:5}}}});
            const take=new VolumeAutomationTake({points:[[0,20,{type:'smooth'}],[5,180]],fallback:100,duration:5,start:1,end:4,mode});
            take.input(.8,60);take.advance(1.2);take.input(1.4,130);take.advance(1.6);take.release(1.8);
            take.advance(2.5);take.input(3,80.1);take.release(3.2);take.advance(4);
            p.tracks.main.automation.volume=take.result();
            const times=[.2,.9999,1,1.2,1.4,1.7999,1.8001,2.5,3,3.1,3.9,4,4.0001,4.8].map(t=>Math.round(t*44100)/44100);
            return {project:validateProject(p),times,values:times.map(t=>curveValue(take.result(),t,100))};
          }))`,c));"""
        output = subprocess.run(['node', '-e', script], text=True, capture_output=True, check=True, cwd=root)
        for authored in json.loads(output.stdout):
            project = validate_project(authored['project'])
            track = project['tracks']['main']
            np.testing.assert_allclose(curve_values(track['automation']['volume'], authored['times'], 100), authored['values'], atol=1e-7)
            frames = 5*SAMPLE_RATE
            mixed = track_block(np.ones((2, frames), dtype=np.float32), track, frames, 0, frames, main=True)
            for time, value in zip(authored['times'], authored['values']):
                envelope = min(1, time/.4, (5-time)/.6)
                np.testing.assert_allclose(mixed[:, round(time*SAMPLE_RATE)], envelope*value/100, atol=1e-6)

    def test_offline_mixer_applies_volume_pan_curves_fades_and_gate(self):
        frames = 2*SAMPLE_RATE
        p = validate_project(dict(version=1, tracks={'main': {'fadeIn': .2, 'fadeOut': .3,
            'automation': {'volume': [[0, 20, dict(type='smooth')], [1, 180, dict(type='hold')], [2, 100]],
                           'pan': [[0, -1, dict(type='ease-in')], [2, 1]]}}}))
        track = p['tracks']['main']
        data = track_block(np.ones((2, frames), dtype=np.float32), track, frames, 0, frames, main=True)
        for t in [.1, .5, .999, 1, 1.5, 1.99]:
            index = round(t*SAMPLE_RATE);time = index/SAMPLE_RATE
            volume = curve_values(track['automation']['volume'], [time], 0)[0]/100
            pan = curve_values(track['automation']['pan'], [time], 0)[0]
            env = min(1, time/.2, (2-time)/.3)
            if pan <= 0:
                expected = [1+np.cos((pan+1)*np.pi/2), np.sin((pan+1)*np.pi/2)]
            else:
                expected = [np.cos(pan*np.pi/2), 1+np.sin(pan*np.pi/2)]
            np.testing.assert_allclose(data[:, index], np.array(expected)*env*volume, atol=1e-6)
