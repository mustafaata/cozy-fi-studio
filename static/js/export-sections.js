/* Section boundaries remain in the authored project clock, including fades and keys. */
function exportSectionFilename(name) {
  let filename=name.replaceAll('ı','i').replaceAll('İ','I').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'bolum';
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(filename))filename='bolum_'+filename;
  return filename;
}
function sectionExportRange(project,section) {
  if(!section||section.end>projectDuration(project)+1e-8||section.end-section.start<.05-1e-8)throw new Error('Bölüm aralığı ana montajın içinde en az 0,05 saniye olmalı.');
  const fps=Number(section.output.fps);
  if([section.start,section.end].some(t=>Math.abs(t*fps-Math.round(t*fps))>1e-6))throw new Error('Bölüm giriş/çıkışını çıktı karelerine hizalayın.');
  return {start:section.start,end:section.end};
}
function createExportSection(project,name,start,end) {
  const section={...projectFields({},'exportSection'),id:editId('section_'),name,filename:exportSectionFilename(name),
    start:frameTime(start,Number(project.output.fps)),end:frameTime(end,Number(project.output.fps)),output:copyProject(project.output)};
  sectionExportRange(project,section);project.exportSections.push(section);return section.id;
}
