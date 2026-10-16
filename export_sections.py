"""Resolve a saved export section without changing any authored project clocks."""
import copy
from project import project_duration


def section_render(project, section_id):
    if section_id is None:
        return project, None, None
    section = next((s for s in project['exportSections'] if s['id'] == section_id), None)
    if section is None:
        raise ValueError('Dışa aktarılacak bölüm bulunamadı.')
    duration = project_duration(project)
    start, end, fps = section['start'], section['end'], int(section['output']['fps'])
    if end > duration+1e-8:
        raise ValueError('Bölüm ana montajın sonunu aşıyor. Giriş/çıkış işaretlerini düzeltin.')
    if any(abs(t*fps-round(t*fps)) > 1e-6 for t in (start, end)):
        raise ValueError('Bölüm giriş/çıkışını bölümün çıktı karelerine hizalayın.')
    result = copy.deepcopy(project)
    result['output'] = copy.deepcopy(section['output'])
    return result, (start, end), section['filename']
