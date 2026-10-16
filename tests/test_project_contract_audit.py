"""Keep the trusted project boundary aligned with browser validation."""
import unittest

from project import validate_project


class ProjectContractAuditTests(unittest.TestCase):
    def test_lyric_time_base_roundtrip_legacy_default_and_invalid_values(self):
        for basis in ('source','project'):
            p=validate_project(dict(version=1,tracks=dict(main={}),lyrics=dict(timeBase=basis)))
            self.assertEqual(p['lyrics']['timeBase'],basis)
        self.assertEqual(validate_project(dict(version=1,tracks=dict(main={})))['lyrics']['timeBase'],'source')
        for invalid in (None,0,True,'timeline',[],{}):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_project(dict(version=1,tracks=dict(main={}),lyrics=dict(timeBase=invalid)))

    def test_group_edit_locks_roundtrip_and_require_booleans(self):
        project=validate_project(dict(version=1,tracks=dict(main=dict(groupLocked=True)),video=dict(groupLocked=True)))
        self.assertTrue(project['tracks']['main']['groupLocked'])
        self.assertTrue(project['video']['groupLocked'])
        legacy=validate_project(dict(version=1,tracks=dict(main={})))
        self.assertFalse(legacy['tracks']['main']['groupLocked'])
        self.assertFalse(legacy['video']['groupLocked'])
        for invalid in (None,0,1,'true',[]):
            with self.subTest(scope='audio',invalid=invalid),self.assertRaises(ValueError):
                validate_project(dict(version=1,tracks=dict(main=dict(groupLocked=invalid))))
            with self.subTest(scope='video',invalid=invalid),self.assertRaises(ValueError):
                validate_project(dict(version=1,tracks=dict(main={}),video=dict(groupLocked=invalid)))

    def test_explicit_invalid_sections_and_collections_are_rejected(self):
        base = dict(version=1, tracks=dict(main={}))
        for section in ('effects', 'master', 'background', 'overlay', 'video', 'output', 'lyrics', 'rhythm'):
            for invalid in (None, False, 0, ''):
                with self.subTest(section=section, invalid=invalid), self.assertRaises(ValueError):
                    validate_project(dict(base, **{section: invalid}))
            validate_project(dict(base, **{section: {}}))
        for section in ('videoClips', 'markers', 'visualLayers', 'visualGroups'):
            with self.subTest(section=section), self.assertRaises(ValueError):
                validate_project(dict(base, **{section: None}))
            validate_project(dict(base, **{section: []}))
        validate_project(base)

    def test_nullable_numeric_fields_reject_nonfinite_values(self):
        for invalid in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(field='end', invalid=invalid), self.assertRaises(ValueError):
                validate_project(dict(version=1, tracks=dict(main=dict(end=invalid))))
            with self.subTest(field='freezeAt', invalid=invalid), self.assertRaises(ValueError):
                validate_project(dict(version=1, tracks=dict(main={}), video=dict(timeRemap=dict(freezeAt=invalid))))
