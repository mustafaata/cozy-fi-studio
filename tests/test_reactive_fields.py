import unittest
from project import SCHEMA,validate_creative_reactive_fx,validate_project


class ReactiveFieldContractTests(unittest.TestCase):
    def test_all_ten_continuous_curves_and_project_source_roundtrips(self):
        for preset in SCHEMA['creativeReactivePresets'][20:30]:
            with self.subTest(preset=preset['id']):
                curves={k:[[0,s['min']],[2,s['max']]] for k,s in preset['parameters'].items() if s['automatable']}
                fx=validate_creative_reactive_fx(dict(preset=preset['id'],automation=curves))
                self.assertEqual(fx['automation'],curves)
                for point in ('pre','post'):
                    p=validate_project(dict(version=SCHEMA['version'],tracks=dict(main=dict(bus='voice')),audioBuses=[dict(id='voice',name='Vokal')],video=dict(reactiveFx=fx,reactiveAnalysis=dict(source='b:voice',point=point))))
                    self.assertEqual(p['video']['reactiveFx'],fx);self.assertEqual(validate_project(p),p)

    def test_counts_options_seeds_bands_and_structural_curves_reject_external_values(self):
        for preset in SCHEMA['creativeReactivePresets'][20:30]:
            for key,spec in preset['parameters'].items():
                with self.subTest(preset=preset['id'],key=key),self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset=preset['id'],parameters={key:spec['max']+1}))
                if spec['automatable'] is False:
                    with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset=preset['id'],automation={key:[[0,spec['default']]]}))
                if spec.get('integer'):
                    with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset=preset['id'],parameters={key:spec['default']+.5}))
        with self.assertRaises(ValueError):validate_creative_reactive_fx(dict(preset='ARX-22',parameters=dict(bandLow=5000,bandHigh=3000)))
