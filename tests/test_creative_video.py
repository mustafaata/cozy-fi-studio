"""The trusted project boundary uses the same preset contract as the browser."""
import copy
import unittest

from project import SCHEMA, validate_creative_video_fx, validate_project


class CreativeVideoContract(unittest.TestCase):
    def test_reverse_echo_bounds_structural_count_and_continuous_curves(self):
        effect=validate_creative_video_fx(dict(preset='VFX-35',parameters=dict(count=6),automation=dict(interval=[[0,.02],[2,.5]],falloff=[[0,0],[2,100]],amount=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['count'],6)
        for value in (dict(parameters=dict(count=0)),dict(parameters=dict(count=7)),dict(parameters=dict(count=2.5)),dict(parameters=dict(interval=0)),dict(parameters=dict(interval=.51)),dict(parameters=dict(falloff=101)),dict(parameters=dict(falloff=True)),dict(automation=dict(count=[[0,3]]))):
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset='VFX-35',**value))

    def test_motion_smear_sample_bounds_threshold_and_trail_curves(self):
        effect=validate_creative_video_fx(dict(preset='VFX-34',parameters=dict(count=6),automation=dict(trail=[[0,0],[2,1.5]],threshold=[[0,0],[2,100]],amount=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['count'],6)
        for value in (dict(parameters=dict(count=0)),dict(parameters=dict(count=7)),dict(parameters=dict(count=2.5)),dict(parameters=dict(trail=-.01)),dict(parameters=dict(trail=1.6)),dict(parameters=dict(threshold=101)),dict(parameters=dict(threshold=True)),dict(automation=dict(count=[[0,3]]))):
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset='VFX-34',**value))

    def test_shutter_hold_curves_structural_clock_and_bounded_parameters(self):
        effect=validate_creative_video_fx(dict(preset='VFX-33',parameters=dict(hold=3,interval=.05,phase=99.9),automation=dict(hold=[[0,0],[2,3]],amount=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['phase'],99.9)
        for value in (dict(parameters=dict(hold=-.01)),dict(parameters=dict(hold=3.1)),dict(parameters=dict(interval=0)),dict(parameters=dict(interval=3.1)),dict(parameters=dict(phase=101)),dict(parameters=dict(phase=True)),dict(automation=dict(interval=[[0,.5]])),dict(automation=dict(phase=[[0,50]]))):
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset='VFX-33',**value))

    def test_time_slice_structural_direction_count_and_continuous_curves(self):
        effect=validate_creative_video_fx(dict(preset='VFX-32',parameters=dict(count=7,direction=3),automation=dict(delay=[[0,0],[2,1.5]],softness=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['count'],7);self.assertEqual(effect['parameters']['direction'],3)
        for value in (dict(parameters=dict(count=1)),dict(parameters=dict(count=8)),dict(parameters=dict(count=2.5)),dict(parameters=dict(direction=.5)),dict(parameters=dict(direction=4)),dict(parameters=dict(delay=-.01)),dict(parameters=dict(softness=101)),dict(automation=dict(count=[[0,3]])),dict(automation=dict(direction=[[0,1]]))):
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset='VFX-32',**value))

    def test_temporal_count_structural_bounds_and_curves(self):
        effect=validate_creative_video_fx(dict(preset='VFX-31',parameters=dict(count=6),automation=dict(interval=[[0,.02],[2,.5]],falloff=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['count'],6)
        for value in (dict(parameters=dict(count=1.5)),dict(parameters=dict(count=7)),dict(parameters=dict(interval=0)),dict(parameters=dict(falloff=101)),dict(automation=dict(count=[[0,3]]))):
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset='VFX-31',**value))

    def test_all_presets_roundtrip_in_each_supported_target(self):
        for preset in SCHEMA['creativeVideoPresets']:
            with self.subTest(preset=preset['id']):
                effect=validate_creative_video_fx({'preset':preset['id']})
                self.assertEqual(set(effect['parameters']),set(preset['parameters']))
                project=validate_project({'version':SCHEMA['version'],'tracks':{'main':{}}})
                project['video']['creativeFx']=copy.deepcopy(effect)
                project['videoClips']=[dict(id='fx-clip',asset='a'*64,creativeFx=copy.deepcopy(effect))]
                project['visualLayers']=[dict(id='fx-layer',type='image',asset='b'*64,creativeFx=copy.deepcopy(effect))]
                result=validate_project(project)
                self.assertEqual(result['video']['creativeFx'],effect)
                self.assertEqual(result['videoClips'][0]['creativeFx'],effect)
                self.assertEqual(result['visualLayers'][0]['creativeFx'],effect)
                self.assertEqual(validate_project(result),result)

    def test_untrusted_effects_rejected(self):
        for value in [{'preset':'bad'}, {'preset':'VFX-01','parameters':{'warmth':True}},
                      {'preset':'VFX-01','parameters':{'warmth':float('nan')}},
                      {'preset':'VFX-01','parameters':{'unexpected':3}},
                      {'preset':'VFX-07','automation':{'seed':[[0,1]]}},
                      {'preset':'VFX-01','automation':{'warmth':[[0,101]]}},
                      {'preset':'VFX-01','extra':1}]:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_creative_video_fx(value)

    def test_optical_advanced_parameters_and_discrete_fill(self):
        effect=validate_creative_video_fx(dict(preset='VFX-14',parameters=dict(centerAY=35),automation=dict(centerAY=[[0,0],[2,100]])))
        self.assertEqual(effect['parameters']['centerAY'],35)
        self.assertEqual(effect['automation']['centerAY'][1][:2],[2,100])
        for value in [dict(preset='VFX-16',parameters=dict(fill=.5)),dict(preset='VFX-16',automation=dict(fill=[[0,1]])),dict(preset='VFX-14',parameters=dict(centerAY=101))]:
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_video_fx(value)

    def test_curves_and_defaults_preserved(self):
        effect=validate_creative_video_fx({'preset':'VFX-01','automation':{'warmth':[[0,10],[2,80,{'type':'smooth'}]]}})
        self.assertEqual(effect['parameters']['warmth'],45)
        self.assertEqual(effect['automation']['warmth'][1][2],{'type':'smooth'})

    def test_geometry_digital_curves_discrete_controls_and_integer_seeds(self):
        for preset in SCHEMA['creativeVideoPresets'][20:30]:
            curves={key:[[0,spec['min']],[2,spec['max']]] for key,spec in preset['parameters'].items() if spec.get('automatable',True)}
            effect=validate_creative_video_fx(dict(preset=preset['id'],automation=curves));self.assertEqual(effect['automation'],curves)
            for key,spec in preset['parameters'].items():
                with self.subTest(preset=preset['id'],parameter=key),self.assertRaises(ValueError):validate_creative_video_fx(dict(preset=preset['id'],parameters={key:spec['max']+1}))
                if not spec.get('automatable',True):
                    with self.assertRaises(ValueError):validate_creative_video_fx(dict(preset=preset['id'],automation={key:[[0,spec['default']]]}))
                if spec.get('integer'):
                    with self.assertRaises(ValueError):validate_creative_video_fx(dict(preset=preset['id'],parameters={key:spec['default']+.5}))
