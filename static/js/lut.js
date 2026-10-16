/* .cube stores red fastest, followed by green and blue. The renderer uses trilinear interpolation. */
function parseCube(text,name='LUT') {
  if(typeof text!=='string'||text.length>PROJECT_SCHEMA.lutLimits.textBytes)throw new Error('LUT dosyası en fazla 8 MB olabilir.');
  const table={...projectFields({},'lutTable'),id:editId('lut_'),name:name.slice(0,180)},seen=new Set();let size=null;
  const numbers=(line,count)=>{
    const tokens=line.trim().split(/\s+/);if(tokens.length!==count||tokens.some(token=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(token)))throw new Error('LUT satırında geçerli sayılar gerekli.');
    const values=tokens.map(Number);if(values.some(n=>!Number.isFinite(n)))throw new Error('LUT sayıları sonlu olmalı.');return values;
  };
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trim().replace(/\s+#.*$/,'');if(!line||line.startsWith('#'))continue;
    if(/^TITLE\s/.test(line)) {const match=line.match(/^TITLE\s+"([^"\r\n]*)"$/);if(!match||seen.has('TITLE')||table.data.length)throw new Error('Geçersiz LUT başlığı.');seen.add('TITLE');table.name=(match[1].trim()||name).slice(0,180);continue;}
    const header=line.match(/^(LUT_3D_SIZE|DOMAIN_MIN|DOMAIN_MAX)\s+(.+)$/);
    if(header) {
      const key=header[1];if(seen.has(key)||table.data.length)throw new Error('LUT başlıkları veriden önce ve tek kez gelmeli.');seen.add(key);
      if(key==='LUT_3D_SIZE'){size=numbers(header[2],1)[0];if(!Number.isInteger(size)||size<2||size>33)throw new Error('3D LUT boyutu 2–33 arasında olmalı.');table.size=size;}
      else table[key==='DOMAIN_MIN'?'domainMin':'domainMax']=numbers(header[2],3);continue;
    }
    if(/^[A-Za-z_]/.test(line))throw new Error('Bu LUT yönergesi desteklenmiyor; yalnızca saf 3D .cube tabloları içe aktarılır.');
    if(size===null)throw new Error('LUT_3D_SIZE başlığı gerekli.');
    if(table.data.length>=size**3*3)throw new Error('LUT tablosunda fazla renk satırı var.');
    table.data.push(...numbers(line,3).map(n=>Math.round(n*1e6)/1e6));
  }
  if(size===null)throw new Error('3D LUT boyutu eksik.');return validateLutTable(table);
}
function lutFor(project,settings) {return settings?.enabled&&settings.intensity>0?{settings,table:project.luts.find(table=>table.id===settings.table)}:null;}
function lutPixel(rgb,table,intensity=100) {
  const n=table.size,p=rgb.map((v,i)=>Math.max(0,Math.min(1,(v-table.domainMin[i])/(table.domainMax[i]-table.domainMin[i])))*(n-1)),lo=p.map(Math.floor),hi=lo.map(v=>Math.min(n-1,v+1)),f=p.map((v,i)=>v-lo[i]),out=[0,0,0];
  for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++) {
    const index=((b?hi[2]:lo[2])*n*n+(g?hi[1]:lo[1])*n+(r?hi[0]:lo[0]))*3,weight=(r?f[0]:1-f[0])*(g?f[1]:1-f[1])*(b?f[2]:1-f[2]);
    for(let c=0;c<3;c++)out[c]+=table.data[index+c]*weight;
  }
  return out.map((v,i)=>Math.max(0,Math.min(1,rgb[i]+(v-rgb[i])*intensity/100)));
}
