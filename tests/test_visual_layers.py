import copy
import unittest
from project import validate_project


class VisualLayerContractTests(unittest.TestCase):
    def project(self):
        return dict(version=1, tracks=dict(main={}), visualGroups=[dict(id='group')], visualLayers=[
            dict(id='film', type='video', asset='a'*64, group='group', offset=1, until=4, start=.5, end=2.5),
            dict(id='png', type='image', asset='b'*64), dict(id='text', type='text', text='Başlık\nİkinci satır')])

    def test_defaults_legacy_round_trip_and_stack_order(self):
        legacy = validate_project(dict(version=1, tracks=dict(main={})))
        self.assertEqual(legacy['visualLayers'], [])
        self.assertEqual(legacy['visualGroups'], [])
        project = validate_project(self.project())
        self.assertEqual(validate_project(project), project)
        self.assertEqual([layer['id'] for layer in project['visualLayers']], ['film', 'png', 'text'])
        self.assertEqual(project['visualLayers'][0]['phase'], 0)

    def test_external_scalar_metadata_is_strict(self):
        for key, values in dict(opacity=[True, None, '50', float('nan'), -1, 101],
                                visible=[1, None, 'true'], locked=[0, None],
                                blend=['copy', 'destination-out', None], font=['bad-font', None],
                                textColor=['red', '#fff', '#FFFFFF;'], type=['svg', None],
                                asset=['../private', 'https://example.com/media'],
                                until=[.5, 1, True], phase=[3, -1]).items():
            for value in values:
                project = self.project(); project['visualLayers'][0][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate_project(project)

    def test_group_references_duplicate_ids_and_resource_limits(self):
        cases=[]
        for key in ['visualLayers', 'visualGroups']:
            p=self.project();p[key]=None;cases.append(p)
            p=self.project();p[key]=[dict(id=str(i)) for i in range(17)];cases.append(p)
        p=self.project();p['visualLayers'][0]['group']='missing';cases.append(p)
        p=self.project();p['visualLayers'][1]['id']='film';cases.append(p)
        p=self.project();p['visualGroups']*=2;cases.append(p)
        for p in cases:
            with self.subTest(project=p), self.assertRaises(ValueError):validate_project(p)

    def test_text_media_kinds_and_control_characters(self):
        for patch in [dict(text=' '), dict(text='x\x00y'), dict(text='x\x0cy'), dict(asset='a'*64)]:
            p=self.project();p['visualLayers'][2].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):validate_project(p)
        for blend in ['source-over','multiply','screen','overlay','darken','lighten','difference','exclusion','lighter']:
            p=self.project();p['visualLayers'][2]['blend']=blend
            self.assertEqual(validate_project(p)['visualLayers'][2]['blend'],blend)

    def test_validation_copies_nested_state_and_reserves_archive_names(self):
        p=self.project();original=copy.deepcopy(p);result=validate_project(p)
        result['visualGroups'][0]['locked']=True;result['visualLayers'][0]['name']='changed'
        self.assertEqual(p,original)
        p['tracks']['visual_000']={}
        with self.assertRaises(ValueError):validate_project(p)

    def test_render_rejects_missing_layer_assets_before_starting_a_job(self):
        import io
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import app
        import media_assets
        def registered(asset):
            if asset=='c'*64:return '/registered.mp4'
            raise FileNotFoundError('Kaynak yok.')
        for kind in ['image','video']:
            project=validate_project(self.project())
            project['tracks']['main']['source']=dict(name='x.wav',size=4,lastModified=0,duration=3)
            project['background']['asset']='c'*64
            project['visualLayers']=[dict(id='missing',type=kind,asset='f'*64)]
            with tempfile.TemporaryDirectory() as folder, patch.object(media_assets,'ASSET_DIR',Path(folder)), \
                    patch.object(media_assets,'source_path',side_effect=registered), \
                    patch.object(app.threading,'Thread') as worker:
                response=app.app.test_client().post('/render',data={'project':json.dumps(project),
                    'main_file':(io.BytesIO(b'RIFF'),'x.wav')})
                self.assertEqual(response.status_code,400,response.json)
                self.assertEqual(response.json['status'],'error');worker.assert_not_called()
