import copy
import unittest
from project import SCHEMA, validate_creative_text_fx, validate_project


class TextFxContract(unittest.TestCase):
    def test_kinetic_curves_limits_and_structural_values(self):
        for preset in SCHEMA['creativeTextPresets'][20:30]:
            curves={key:[[0,spec['min']],[2,spec['max']]] for key,spec in preset['parameters'].items() if spec['automatable']}
            self.assertEqual(validate_creative_text_fx(dict(preset=preset['id'],automation=curves))['automation'],curves)
            for key,spec in preset['parameters'].items():
                with self.subTest(preset=preset['id'],key=key),self.assertRaises(ValueError):validate_creative_text_fx(dict(preset=preset['id'],parameters={key:spec['max']+1}))
                if not spec['automatable']:
                    with self.assertRaises(ValueError):validate_creative_text_fx(dict(preset=preset['id'],automation={key:[[0,spec['default']]]}))
        for id in ['TFX-21','TFX-23']:
            with self.assertRaises(ValueError):validate_creative_text_fx(dict(preset=id,parameters=dict(seed=1.5)))

    def test_all_presets_roundtrip_for_text_title_and_lyrics(self):
        for preset in SCHEMA['creativeTextPresets']:
            with self.subTest(preset=preset['id']):
                effect=validate_creative_text_fx(dict(preset=preset['id']))
                project=validate_project(dict(version=1,tracks=dict(main={})))
                project['lyrics']['textFx']=copy.deepcopy(effect)
                project['visualLayers']=[dict(id=kind,type=kind,text='İstanbul 👨‍👩‍👧‍👦',textFx=copy.deepcopy(effect)) for kind in ('text','title')]
                result=validate_project(project)
                self.assertEqual(result['lyrics']['textFx'],effect)
                for layer in result['visualLayers']:
                    self.assertEqual(layer['textFx'],effect)
                self.assertEqual(validate_project(result),result)

    def test_invalid_parameters_and_structural_curves_rejected(self):
        for value in [dict(preset='TFX-99'),dict(preset='TFX-01',parameters=dict(stagger=True)),dict(preset='TFX-01',parameters=dict(duration=float('nan'))),dict(preset='TFX-09',parameters=dict(axis=.5)),dict(preset='TFX-05',automation=dict(seed=[[0,1]])),dict(preset='TFX-01',parameters=dict(unknown=2)),dict(preset='TFX-12',parameters=dict(order=.5)),dict(preset='TFX-13',automation=dict(seed=[[0,1]]))]:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_creative_text_fx(value)

    def test_material_curves_and_server_limits_roundtrip(self):
        for preset in SCHEMA['creativeTextPresets'][15:20]:
            parameters=preset['parameters']
            curves={key:[[0,spec['min']],[2,spec['max']]] for key,spec in parameters.items() if spec['automatable']}
            effect=validate_creative_text_fx(dict(preset=preset['id'],automation=curves))
            self.assertEqual(effect['automation'],curves)
            for key,spec in parameters.items():
                with self.subTest(preset=preset['id'],parameter=key),self.assertRaises(ValueError):
                    validate_creative_text_fx(dict(preset=preset['id'],parameters={key:spec['max']+1}))
            if 'seed' in parameters:
                with self.assertRaises(ValueError):validate_creative_text_fx(dict(preset=preset['id'],automation=dict(seed=[[0,1]])))
                with self.assertRaises(ValueError):validate_creative_text_fx(dict(preset=preset['id'],parameters=dict(seed=1.5)))
