/* Project-time parameter curves use a separate surface from source trim and zoom. */
class AutomationEditor {
  constructor(kind, inspector) {
    this.lifetime=new UiLifetime();this.kind = kind;
    this.parameter = 'volume';
    this.selected = -1;
    this.drag = null;
    this.time = 0;
    this.panel = document.createElement('details');
    this.panel.className = 'automation-editor';
    this.panel.innerHTML = `
      <summary>Ses otomasyonu <span class="automation-state"></span></summary>
      <div class="automation-content">
        <p class="automation-help">Proje zamanı · Nokta eklemek için tıklayın, taşımak için sürükleyin. Eğri, seçili parametrenin sabit değerinin yerine uygulanır; kesit ve yumuşak giriş/çıkış korunur.</p>
        <div class="automation-presets">
          <label>Hazır eğri<select class="automation-preset">
            <option value="flat">Sabit seviye</option><option value="in">Yavaşça yüksel</option>
            <option value="out">Yavaşça azal</option><option value="swell">Yüksel ve azal</option>
          </select></label>
          <button type="button" class="ghost automation-apply">Uygula</button>
        </div>
        <canvas class="automation-curve" tabindex="0" aria-label="Ses seviyesi eğrisi; ok tuşları seçili noktaları taşır, Delete siler; Ctrl veya Command ile A tümünü seçer, C kopyalar, V yapıştırır"></canvas>
        <div class="automation-axis"><span>0 sn</span><span class="automation-duration"></span></div>
        <label class="automation-point-label">Nokta<select class="automation-point"><option value="-1">Nokta yok</option></select></label>
        <div class="automation-fields">
          <label>Zaman<input class="automation-time" data-time-unit type="number" min="0" step="any" aria-label="Otomasyon zamanı"></label>
          <label><span class="automation-value-label">Seviye · %</span><input class="automation-value" type="number" min="0" max="200" step="any"></label>
        </div>
        <div class="automation-actions">
          <button type="button" class="ghost automation-add">İmlece ekle</button>
          <button type="button" class="ghost automation-delete">Noktayı sil</button>
          <button type="button" class="ghost automation-clear">Eğriyi kaldır</button>
        </div>
        <output class="automation-readout" aria-live="off"></output>
      </div>`;
    inspector.append(this.panel);
    this.content = this.panel.querySelector('.automation-content');
    this.canvas = this.content.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pointSelect = this.content.querySelector('.automation-point');
    this.timeInput = this.content.querySelector('.automation-time');
    this.valueInput = this.content.querySelector('.automation-value');
    this.segment=new CurveSegmentEditor(this.content,()=>({points:this.getPoints(),index:this.selected}),
      (descriptor,index)=>{const points=copyProject(this.getPoints());points[index]=points[index].slice(0,2);if(descriptor.type!=='linear')points[index].push(descriptor);this.setPoints(points);});
    this.parameters=new AutomationParameters(this);
    this.tools=new AutomationTools(this);
    this.recorder=new AutomationRecorder(this);
    this.bindEvents();
    this.lifetime.on(projectStore,'change', () => {
      const key=JSON.stringify([this.track,this.duration]);if(key===this.storeKey)return;this.storeKey=key;
      // Undo or project replacement cancels a pending pointer edit.
      this.tools.cancel();this.tools.reconcile();
      this.refresh();
    });
    this.lifetime.on(window.timelineView,'change',()=>{this.tools.cancel();this.refresh();});
    this.lifetime.on(document,'project-time', event => {
      this.time = event.detail.time;
      if (this.panel.open && this.track) { this.updateReadout(); this.draw(); }
    });
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvas);
    this.themeQuery = window.matchMedia('(prefers-color-scheme: light)');
    this.lifetime.on(this.themeQuery,'change', () => this.draw());
    this.refresh();
  }

  get track() { return projectStore.state.tracks[this.kind]; }
  get duration() { return projectDuration(projectStore.state); }
  get visibleStart() { return window.timelineView.start; }
  get visibleEnd() { return Math.min(this.duration,this.visibleStart+window.timelineView.span); }
  get spec() { return PROJECT_SCHEMA.automationParameters[this.parameter]; }
  get bounds() { return [this.spec.min,this.spec.max]; }
  get fallback() { return this.track?.[this.parameter]??PROJECT_SCHEMA.track[this.parameter].default; }
  getPoints() { return this.track?.automation[this.parameter] || []; }
  setParameter(parameter) {
    if(!Object.hasOwn(PROJECT_SCHEMA.automationParameters,parameter)||parameter===this.parameter)return;
    this.recorder?.finish();this.tools.cancel();this.parameter=parameter;this.selected=-1;this.tools.select(-1);
    this.tools.low=this.spec.min;this.tools.high=this.spec.max;this.pointsKey=null;this.tools.listKey=null;
    this.refresh();
  }
  formatValue(value,parameter=this.parameter) {
    if(parameter==='pan')return Math.abs(value)<.00001?'Merkez':`${value<0?'L':'R'} %${Number((Math.abs(value)*100).toFixed(1))}`;
    if(parameter==='cutoff')return value>=PROJECT_SCHEMA.track.cutoff.default?'Açık':`${Number(value.toFixed(1))} Hz`;
    return `%${Number(value.toFixed(2))}`;
  }
  error(message) { document.dispatchEvent(new CustomEvent('studio-error', {detail:message})); }
  setPoints(points) {
    if (!this.track) return false;
    return window.change(project => { project.tracks[this.kind].automation[this.parameter] = points; });
  }

  updateState() {
    const count=this.getPoints().length;
    this.panel.querySelector('.automation-state').textContent=this.recorder?.armed?
      (this.recorder.take?.writing?'Kaydediliyor':'Kayıt hazır'):(count?`Etkin · ${count} nokta`:'Kapalı');
  }

  refresh() {
    if (!this.track) return;
    const points = this.getPoints();
    this.selected = Math.min(this.selected, points.length - 1);
    if (this.selected < 0 && points.length && !this.tools) this.selected = 0;
    this.updateState();
    this.parameters.refresh();
    if(this.recorder)this.recorder.root.hidden=this.parameter!=='volume';
    this.valueInput.min=this.spec.min;this.valueInput.max=this.spec.max;
    this.content.querySelector('.automation-value-label').textContent=`Değer · ${this.spec.unit}`;
    this.canvas.setAttribute('aria-label',`${this.spec.label} eğrisi; ok tuşları seçili noktaları taşır, Delete siler; Ctrl veya Command ile A tümünü seçer, C kopyalar, V yapıştırır`);
    this.content.querySelector('.automation-axis span').textContent = `${this.visibleStart.toFixed(2)} sn`;
    this.content.querySelector('.automation-duration').textContent = `${this.visibleEnd.toFixed(2)} sn`;
    const pointsKey = JSON.stringify(points);
    if (pointsKey !== this.pointsKey) {
      this.pointSelect.replaceChildren();
      if (!points.length) this.pointSelect.add(new Option('Nokta yok', '-1'));
      points.forEach(([time, value], index) => this.pointSelect.add(new Option(`${index + 1} · ${time.toFixed(2)} sn · ${this.formatValue(value)}`, String(index))));
      this.pointsKey = pointsKey;
    }
    this.pointSelect.value = String(this.selected);
    const point = points[this.selected];
    this.timeInput.value = point ? point[0] : '';
    this.valueInput.value = point ? point[1] : '';
    this.timeInput.max = String(PROJECT_SCHEMA.maxDuration);
    this.timeInput.disabled = this.valueInput.disabled = !point;
    this.pointSelect.disabled = !points.length;
    this.content.querySelector('.automation-delete').disabled = !point;
    this.content.querySelector('.automation-clear').disabled = !points.length;
    for (const selector of ['.automation-add', '.automation-apply']) this.content.querySelector(selector).disabled = this.duration <= 0;
    this.updateReadout();
    this.draw();
    this.segment?.refresh();
    this.tools?.sync();
  }

  updateReadout() {
    const value = this.parameter==='volume'?audioEngine.automationVolumeAt(this.kind,this.time):curveValue(this.getPoints(),this.time,this.fallback);
    this.content.querySelector('.automation-readout').textContent = `${this.time.toFixed(2)} sn · ${this.spec.label} ${this.formatValue(value)}${this.getPoints().length ? ' · Otomasyon etkin' : ' · Sabit değer'}`;
  }

  addPoint(time, value) {
    if (this.duration <= 0) return;
    const points = copyProject(this.getPoints());
    time = Math.min(this.duration, Math.round(clamp(time, 0, this.duration) * 1000) / 1000);
    const existing = points.findIndex(([t]) => Math.abs(t - time) < .001);
    if (existing >= 0) {
      points[existing][1] = value;
      this.selected = existing;
    } else {
      if (points.length >= PROJECT_SCHEMA.limits.automationPoints) {
        this.error('Otomasyon noktası sınırına ulaşıldı. Önce bir noktayı silin.');
        return;
      }
      this.selected = insertCurvePoint(points,time,value);
    }
    this.setPoints(points);
  }

  editPoint(time, value) {
    const points = this.getPoints().map(point => [...point]);
    if (!points[this.selected]) return;
    if (!Number.isFinite(time) || !Number.isFinite(value) || time < 0 || time > PROJECT_SCHEMA.maxDuration || value < this.spec.min || value > this.spec.max ||
        (this.selected > 0 && time <= points[this.selected - 1][0]) ||
        (this.selected + 1 < points.length && time >= points[this.selected + 1][0])) {
      this.error('Zaman komşu noktalar arasında, değer parametre sınırları içinde olmalı.');
      this.refresh();
      return;
    }
    points[this.selected] = [time, value,...points[this.selected].slice(2)];
    this.setPoints(points);
  }

  removePoint() {
    if (this.selected < 0) return;
    const points = this.getPoints().map(point => [...point]);
    points.splice(this.selected, 1);
    this.setPoints(points);
  }

  applyPreset() {
    const duration = this.duration;
    if (duration <= 0) return;
    const level = this.fallback,low=this.spec.min;
    const curves = {
      flat: [[0, level], [duration, level]], in: [[0, low], [duration, level]],
      out: [[0, level], [duration, low]], swell: [[0, low], [duration / 2, level], [duration, low]]
    };
    this.selected = 0;
    this.setPoints(curves[this.content.querySelector('.automation-preset').value]);
  }

  geometry() {
    const bounds = this.canvas.getBoundingClientRect();
    this.dimensions = {width:bounds.width, height:bounds.height,
      padding:parseFloat(getComputedStyle(this.panel).getPropertyValue('--space-3'))};
    return this.dimensions;
  }
  position(time, value) {
    const {width, height, padding} = this.dimensions || this.geometry();
    const low=this.tools?.low??this.spec.min,high=this.tools?.high??this.spec.max;
    return [padding + window.timelineView.fraction(time) * (width - 2 * padding), padding + (1 - (value-low)/(high-low)) * (height - 2 * padding)];
  }
  pointerValue(event) {
    const rect = this.canvas.getBoundingClientRect();
    const {width, height, padding} = this.geometry();
    return [window.timelineView.time((event.clientX - rect.left - padding) / Math.max(1, width - 2 * padding)),
      Number(((this.tools?.low??this.spec.min)+clamp(1 - (event.clientY - rect.top - padding) / Math.max(1,height - 2 * padding), 0, 1) * ((this.tools?.high??this.spec.max)-(this.tools?.low??this.spec.min))).toFixed(3))];
  }

  draw() {
    if (!this.panel.open || !this.track) return;
    this.parameters?.draw();
    const {width, height, padding} = this.geometry();
    if (width <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(this.panel);
    const color = token => style.getPropertyValue(token).trim();
    ctx.clearRect(0, 0, width, height);
    ctx.font = `${style.getPropertyValue('--text-xs')} ${style.getPropertyValue('--font-ui')}`;
    const low=this.tools?.low??0,high=this.tools?.high??200;
    for (const value of [low, (low+high)/2, high]) {
      const y = this.position(0, value)[1];
      ctx.strokeStyle = color('--line');
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
      ctx.fillStyle = color('--muted'); ctx.fillText(this.formatValue(value), padding, Math.max(10, y - 4));
    }
    ctx.save();ctx.beginPath();ctx.rect(padding,padding,width-2*padding,height-2*padding);ctx.clip();
    ctx.strokeStyle=color('--line');ctx.lineWidth=1;
    for(const time of this.tools?.gridTimes()||[]){const [x]=this.position(time,low);ctx.beginPath();ctx.moveTo(x,padding);ctx.lineTo(x,height-padding);ctx.stroke();}
    const points = this.drag?.points || (this.parameter==='volume'?this.recorder?.preview:null) || this.getPoints();
    const visible=[];
    for(let x=0;x<=Math.ceil(width);x++){const time=this.visibleStart+(this.visibleEnd-this.visibleStart)*x/Math.ceil(width);visible.push([time,automationValue(points,time,this.fallback)]);}
    for(const [time] of points)if(time>=this.visibleStart&&time<=this.visibleEnd)visible.push([time,automationValue(points,time,this.fallback,true)],[time,automationValue(points,time,this.fallback)]);
    visible.sort((a,b)=>a[0]-b[0]);
    ctx.strokeStyle = color('--lamp'); ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach(([t, v], i) => { const [x,y] = this.position(t,v); if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
    ctx.stroke();
    ctx.restore();
    points.forEach(([t,v], i) => {
      if (t < this.visibleStart || t > this.visibleEnd || v<low || v>high) return;
      const [x,y] = this.position(t,v);
      const selected=this.tools?.selection.has(i)||this.drag?.selection?.includes(i);
      ctx.beginPath(); ctx.arc(x,y,selected ? 6 : 4,0,Math.PI * 2);
      ctx.fillStyle = color(selected ? '--lamp' : '--text'); ctx.fill();
    });
    if(this.drag?.box){const [a,b,c,d]=this.drag.box,[x,y]=this.position(a,b),[right,bottom]=this.position(c,d);
      ctx.globalAlpha=.15;ctx.fillStyle=color('--lamp');ctx.fillRect(Math.min(x,right),Math.min(y,bottom),Math.abs(right-x),Math.abs(bottom-y));
      ctx.globalAlpha=1;ctx.strokeStyle=color('--lamp');ctx.strokeRect(Math.min(x,right),Math.min(y,bottom),Math.abs(right-x),Math.abs(bottom-y));}
    const [cursor] = this.position(clamp(this.time,this.visibleStart,this.visibleEnd),0);
    ctx.strokeStyle = color('--success'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cursor,padding); ctx.lineTo(cursor,height-padding); ctx.stroke();
  }

  bindEvents() {
    this.panel.addEventListener('toggle', () => this.refresh());
    this.pointSelect.addEventListener('change', () => { this.tools.select(Number(this.pointSelect.value)); this.refresh(); });
    const edit = () => this.editPoint(this.timeInput.value === '' ? NaN : Number(this.timeInput.value),
      this.valueInput.value === '' ? NaN : Number(this.valueInput.value));
    this.timeInput.addEventListener('change', edit);
    this.valueInput.addEventListener('change', edit);
    this.content.querySelector('.automation-add').addEventListener('click', () => this.addPoint(this.time, automationValue(this.getPoints(),this.time,this.fallback)));
    this.content.querySelector('.automation-delete').addEventListener('click', () => this.removePoint());
    this.content.querySelector('.automation-clear').addEventListener('click', () => this.setPoints([]));
    this.content.querySelector('.automation-apply').addEventListener('click', () => this.applyPreset());

  }
  destroy(){this.recorder.destroy();this.tools.destroy();this.segment.destroy();this.resizeObserver.disconnect();this.lifetime.dispose();this.panel.remove();}
}

window.AutomationEditors = Object.create(null);
document.addEventListener('DOMContentLoaded', () => {
  window.mountAutomationEditor = kind => {
    const inspector = document.getElementById('inspect-' + kind);
    if (inspector && !window.AutomationEditors[kind]) window.AutomationEditors[kind] = new AutomationEditor(kind, inspector);
  };
  for (const kind of Object.keys(projectStore.state.tracks)) window.mountAutomationEditor(kind);
});
