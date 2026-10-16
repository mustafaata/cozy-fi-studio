import unittest
from project import validate_project


class TransitionContractTests(unittest.TestCase):
    def project(self, **fields):
        return {'version': 1, 'tracks': {'main': {}}, 'videoClips': [
            dict(id='clip', asset='a'*64, start=0, end=2, **fields)]}

    def test_legacy_defaults_and_new_effects_round_trip(self):
        clip = validate_project(self.project())['videoClips'][0]
        self.assertEqual(clip['transitionDirection'], 'left')
        self.assertEqual(clip['transitionSoftness'], 0)
        for effect in ['zoom', 'blur']:
            for direction in ['left', 'right', 'up', 'down', 'in', 'out']:
                project = validate_project(self.project(transition=effect, transitionDirection=direction, transitionSoftness=83.5))
                self.assertEqual(validate_project(project), project)

    def test_rejects_invalid_external_metadata(self):
        for key, value in [('transition', 'unknown'), ('transitionDirection', 'diagonal'),
                           ('transitionDirection', None), ('transitionSoftness', True),
                           ('transitionSoftness', None), ('transitionSoftness', '50'),
                           ('transitionSoftness', -1), ('transitionSoftness', 101),
                           ('transitionSoftness', float('nan')), ('transitionSoftness', float('inf'))]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate_project(self.project(**{key: value}))

    def test_new_metadata_does_not_change_legacy_timing(self):
        project = validate_project(self.project(offset=1.5, transitionDuration=.5))
        clip = project['videoClips'][0]
        clip.update(transition='blur', transitionDirection='up', transitionSoftness=100)
        result = validate_project(project)['videoClips'][0]
        self.assertEqual([result[key] for key in ['offset', 'start', 'end', 'transitionDuration']], [1.5, 0, 2, .5])
