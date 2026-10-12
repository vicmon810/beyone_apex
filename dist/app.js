import { LapTimer, demoSample, formatTime, tracks } from './engine.js';
import { createMapSetup } from './map-setup.js';

const element = id => document.getElementById(id);
const storageKey = 'apex.sessions.v1';
let sessions = [];
let mapsKey = '';
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  sessions = Array.isArray(stored) ? stored.filter(session => session && typeof session.id === 'string' && Array.isArray(session.laps) && Array.isArray(session.samples) && session.samples.every(point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) && session.laps.every(lap => lap && Number.isFinite(lap.duration))) : [];
  mapsKey = localStorage.getItem('apex.mapboxToken') || '';
} catch {
  notify('无法读取本地存储；本次仍可试跑，请结束后导出记录。');
}
let track = tracks[0];
let gate = track.gate;
let customGate = false;
let finishGate = null;
let timer = new LapTimer(gate, finishGate);
let running = false;
let session = null;
let elapsed = 0;
let simulationTime = 0;
let lastTick = performance.now();
let lastSampleTime = -1;
let lastSaveTime = 0;
let chartSamples = [];
let watchId = null;
let currentPoint = null;
let currentSessionView = null;
let mapboxMap = null;
let mapboxCar = null;

let mapsLoading = false;
let mapsFailed = false;
let mapsTimeout = null;

function notify(message) { element('notice').textContent = message; }
function isGps() { return element('source-select').value === 'gps'; }
function isSprint() { return isGps() && setup.config().mode === 'sprint'; }
function pathText(points) { return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' '); }
function project(points, width = 760, height = 480) {
  if (!points.length) return [];
  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const longitudeFactor = Math.cos(latitude * Math.PI / 180);
  const horizontal = points.map(point => point.lng * longitudeFactor);
  const vertical = points.map(point => -point.lat);
  const minHorizontal = Math.min(...horizontal);
  const maxHorizontal = Math.max(...horizontal);
  const minVertical = Math.min(...vertical);
  const maxVertical = Math.max(...vertical);
  const scale = Math.min((width - 100) / Math.max(maxHorizontal - minHorizontal, 0.0001), (height - 100) / Math.max(maxVertical - minVertical, 0.0001));
  return points.map((point, index) => [width / 2 + (horizontal[index] - (minHorizontal + maxHorizontal) / 2) * scale, height / 2 + (vertical[index] - (minVertical + maxVertical) / 2) * scale]);
}

function drawMap() {
  const gps = isGps();
  const route = gps ? (session?.samples || []).slice(-1500) : track.path;
  const allPoints = [...route, ...(finishGate || []), ...gate, currentPoint || gate[0]];
  const coordinates = project(allPoints);
  const trackCoordinates = coordinates.slice(0, route.length);
  for (const id of ['track-border', 'track-road', 'track-line']) {
    element(id).setAttribute('d', gps ? '' : pathText(trackCoordinates));
  }
  element('gps-trail').setAttribute('d', gps ? pathText(trackCoordinates) : '');
  const [gateStart, gateEnd, car] = coordinates.slice(-3);
  element('finish-line').setAttribute('visibility', gps && !setup.config().gate ? 'hidden' : 'visible');
  element('destination-line').setAttribute('visibility', finishGate ? 'visible' : 'hidden');
  if (finishGate) {
    const [a, b] = coordinates.slice(route.length, route.length + 2);
    for (const [attribute, value] of Object.entries({x1:a[0], y1:a[1], x2:b[0], y2:b[1]})) element('destination-line').setAttribute(attribute, value);
  }
  for (const [attribute, value] of Object.entries({ x1: gateStart[0], y1: gateStart[1], x2: gateEnd[0], y2: gateEnd[1] })) element('finish-line').setAttribute(attribute, value);
  for (const id of ['car-marker', 'car-halo']) {
    element(id).setAttribute('cx', car[0]);
    element(id).setAttribute('cy', car[1]);
  }
  if (mapboxMap?.getSource('route')) element('map-label').textContent = gps ? 'Mapbox · GPS 计时' : 'Mapbox · 演示路线为虚构';
  element('track-subtitle').textContent = gps ? 'GPS / RELATIVE TRAJECTORY' : track.subtitle;
  element('track-length').textContent = gps ? (isSprint() ? 'A 起点 → B 终点 · 自动计时' : '首次过线开始计时') : `${(track.length / 1000).toFixed(2)} km · 虚构演示赛道`;
  if (mapboxMap?.getSource('route')) {
    mapboxMap.getSource('route').setData(lineFeature(route));
    mapboxMap.getSource('gate').setData(lineFeature(gps && !setup.config().gate ? [] : gate));
    mapboxMap.getSource('destination').setData(lineFeature(finishGate || []));
    const point = currentPoint || gate[0];
    mapboxCar.setLngLat([point.lng, point.lat]);
  }
}

function lineFeature(points) {
  return { type: 'FeatureCollection', features: points.length < 2 ? [] : [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(point => [point.lng, point.lat]) } }] };
}

function fitMapboxMap() {
  if (!mapboxMap) return;
  const bounds = new mapboxgl.LngLatBounds();
  (isGps() ? [...gate, ...(finishGate || [])] : track.path).forEach(point => bounds.extend([point.lng, point.lat]));
  mapboxMap.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 18 });
}

function renderTelemetry(sample) {
  for (const id of ['rpm', 'coolant', 'throttle', 'brake']) element(id).textContent = Math.round(sample[id]).toLocaleString('en-US');
  for (const id of ['throttle', 'brake']) element(`${id}-bar`).style.width = `${sample[id]}%`;
  element('coolant-bar').style.left = `${Math.min(100, Math.max(0, (sample.coolant - 50) / 70 * 100))}%`;
  [...element('rpm-bars').children].forEach((bar, index) => bar.classList.toggle('lit', index / 20 < sample.rpm / 8000));
  chartSamples.push(sample);
  chartSamples = chartSamples.filter(point => point.time >= sample.time - 30);
  for (const channel of ['throttle', 'brake']) element(`${channel}-chart`).setAttribute('points', chartSamples.map(point => `${700 - (sample.time - point.time) / 30 * 700},${145 - point[channel] * 1.4}`).join(' '));
}

function renderTiming() {
  const currentTime = isGps() ? currentPoint?.time : simulationTime;
  const duration = timer.startedAt === null ? 0 : Math.max(0, (timer.finishedAt ?? currentTime ?? timer.startedAt) - timer.startedAt);
  const [whole, fraction] = formatTime(duration).split('.');
  element('lap-time').replaceChildren(document.createTextNode(whole));
  const milliseconds = document.createElement('span');
  milliseconds.textContent = `.${fraction}`;
  element('lap-time').append(milliseconds);
  element('current-lap-label').textContent = isSprint() ? (timer.finishedAt !== null ? '已到达终点 / FINISHED' : '起点 → 终点') : `当前圈 / LAP ${String(timer.laps.length + 1).padStart(2, '0')}`;
  element('lap-count').textContent = timer.laps.length;
  element('completed-unit').textContent = isSprint() ? '次' : '圈';
  element('timing-title').textContent = isSprint() ? '起终点计时' : '圈速计时';
  for (const [id, lap, sprint] of [['best-label', '最快圈速 ↗', '本次成绩'], ['last-label', '上一圈', '完成用时'], ['results-title', '圈速记录', '计时成绩'], ['result-number', '圈数', '次数'], ['result-duration', '圈速', '用时'], ['result-delta', '距最快圈', '状态']]) element(id).textContent = isSprint() ? sprint : lap;
  element('session-time').textContent = formatTime(elapsed).split('.')[0];
}

function renderLaps() {
  const best = timer.laps.length ? Math.min(...timer.laps.map(lap => lap.duration)) : null;
  element('best-lap').textContent = formatTime(best);
  element('last-lap').textContent = formatTime(timer.laps.at(-1)?.duration);
  const body = element('lap-table');
  body.replaceChildren();
  if (!timer.laps.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 3;
    cell.className = 'empty';
    cell.textContent = isSprint() ? '到达终点后，成绩会出现在这里。' : '完成第一圈后，记录会出现在这里。';
  }
  for (const lap of [...timer.laps].reverse()) {
    const row = body.insertRow();
    if (lap.duration === best) row.className = 'best-row';
    [String(lap.number).padStart(2, '0'), formatTime(lap.duration), isSprint() ? '已完成' : lap.duration === best ? 'BEST ↗' : `+${(lap.duration - best).toFixed(3)}`].forEach(value => { row.insertCell().textContent = value; });
  }
}

function acceptPoint(point) {
  currentPoint = point;
  const lap = timer.add(point);
  if (lap) renderLaps();
  if (point.time - lastSampleTime >= 0.5 || !session.samples.length || lap) {
    session.samples.push(point);
    lastSampleTime = point.time;
  }
  element('timing-hint').textContent = timer.startedAt === null ? '等待首次过线，开始计时。' : (isSprint() ? '计时中 · 经过终点自动保存' : '过线自动计圈 · 保持你的节奏');
  updateControls();
  drawMap();
  renderTiming();
  if (timer.finishedAt !== null) stopRecording('已到达终点，成绩与轨迹已尝试保存。');
}

function persistSession() {
  if (!session?.samples.length) return;
  session.duration = elapsed;
  session.laps = [...timer.laps];
  const previous = sessions.findIndex(item => item.id === session.id);
  if (previous >= 0) sessions[previous] = session;
  else sessions.unshift(session);
  try { localStorage.setItem(storageKey, JSON.stringify(sessions)); }
  catch { notify('浏览器存储不可用或空间不足。记录仍在本页面，请在驾驶记录中导出 JSON，避免刷新后丢失。'); }
}

function updateControls() {
  for (const id of ['track-select', 'source-select', 'rate-select', 'gate-button']) element(id).disabled = running;
  element('track-select').disabled = running || isGps();
  element('track-select').parentElement.hidden = isGps();
  element('record-button').textContent = running ? '■ 结束并保存' : isGps() ? '● 准备开始' : '● 开始记录';
  setup.update(isGps(), running);
  element('record-button').classList.toggle('recording-button', running);
  element('record-status').textContent = running ? (timer.startedAt === null ? '等待过线' : 'REC ●') : timer.finishedAt !== null ? '已完成' : 'READY';
  element('record-status').classList.toggle('recording', running);
}

function stopRecording(message = '记录已结束，已尝试保存到此浏览器。可打开驾驶记录回看或导出。') {
  if (!running) return;
  running = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  notify(message);
  persistSession();
  updateControls();
  element('timing-hint').textContent = '本次记录已结束。';
}

function startRecording() {
  if (isGps() && (!navigator.geolocation || !window.isSecureContext)) {
    notify('手机 GPS 需要 HTTPS（或本机 localhost）和浏览器定位支持。当前仍可使用模拟 GPS。');
    return;
  }
  if (isGps() && !customGate) {
    element('gps-settings').scrollIntoView({block:'center'});
    notify('请先在地图上设置起点；起终点模式还需要相距至少 50 米的终点。');
    return;
  }
  timer = new LapTimer(gate, finishGate);
  elapsed = 0;
  simulationTime = 0;
  lastSampleTime = -1;
  lastSaveTime = 0;
  chartSamples = [];
  currentPoint = null;
  lastTick = performance.now();
  session = { id: crypto.randomUUID(), date: new Date().toISOString(), track: isGps() ? setup.config().name : track.name, source: isGps() ? 'gps' : 'demo', telemetry: 'dummy', mode: isSprint() ? 'sprint' : 'lap', gate, finishGate, duration: 0, laps: [], samples: [] };
  running = true;
  updateControls();
  renderLaps();
  renderTiming();
  element('timing-hint').textContent = '等待首次过线，开始计时。';
  if (isGps()) {
    notify('正在获取定位。请保持页面前台；切换后台将结束并保存记录。车辆数据仍为模拟。');
    watchId = navigator.geolocation.watchPosition(position => {
      if (!running) return;
      const { latitude: lat, longitude: lng, accuracy, speed } = position.coords;
      if (Date.now() - position.timestamp > 5000 || accuracy > 30) {
        timer.previous = null;
        timer.startedAt = null;
        timer.travelled = 0;
        updateControls();
        element('position-label').textContent = `定位不佳 · ±${Math.round(accuracy)} m`;
        element('timing-hint').textContent = '定位中断，等待有效定位后重新过线。';
        renderTiming();
        return;
      }
      const dummy = demoSample(elapsed, track);
      const point = { ...dummy, lat, lng, accuracy, speed: speed === null ? null : speed * 3.6, time: position.timestamp / 1000 };
      const firstFix = !currentPoint;
      acceptPoint(point);
      element('position-label').textContent = `手机 GPS · ±${Math.round(accuracy)} m`;
      if (firstFix && mapboxMap) mapboxMap.panTo([point.lng, point.lat]);
    }, error => {
      const messages = { 1: '定位权限被拒绝，请在浏览器设置中允许定位。', 2: '暂时无法获取定位，请移到开阔处重试。', 3: '定位超时，请重试。' };
      stopRecording(messages[error.code] || '定位失败，记录已停止。');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  } else {
    timer.add(demoSample(-0.1, track));
    acceptPoint(demoSample(0.01, track));
    notify('正在模拟驾驶。圈速按模拟时间计算；后台自动结束并保存。车辆数据均为演示数据。');
  }
}

function tick() {
  const now = performance.now();
  const delta = (now - lastTick) / 1000;
  lastTick = now;
  if (!running) return;
  if (delta > 5) { stopRecording('检测到页面长时间挂起，本次记录已结束保存，请重新开始。'); return; }
  const simulatedDelta = delta * (isGps() ? 1 : Number(element('rate-select').value));
  elapsed += simulatedDelta;
  if (!isGps()) {
    const target = simulationTime + simulatedDelta;
    while (simulationTime < target) {
      simulationTime = Math.min(target, simulationTime + 0.1);
      const point = demoSample(simulationTime, track);
      const lap = timer.add(point);
      if (lap) renderLaps();
    }
    const point = demoSample(simulationTime, track);
    acceptPoint(point);
    element('position-label').textContent = `模拟 GPS · ${element('rate-select').value}× 回放`;
  }
  renderTelemetry(demoSample(elapsed, track));
  renderTiming();
  if (elapsed - lastSaveTime >= 10) { persistSession(); lastSaveTime = elapsed; }
  if (elapsed >= 3600) stopRecording('已达到 MVP 单次 60 分钟记录上限，本次记录已结束并保存。');
}

function openHistory() {
  const list = element('history-list');
  list.replaceChildren();
  element('history-detail').hidden = true;
  if (!sessions.length) { const empty = document.createElement('p'); empty.textContent = '还没有记录。开始一次模拟驾驶，结束后就能在这里回看。'; list.append(empty); }
  for (const item of sessions) {
    const button = document.createElement('button');
    button.className = 'history-item';
    const label = document.createElement('span');
    label.textContent = item.track;
    const date = document.createElement('small');
    date.textContent = `${new Date(item.date).toLocaleString('zh-CN')} · ${item.source === 'gps' ? '手机 GPS / 模拟 OBD' : '模拟驾驶'}`;
    label.append(date);
    const count = document.createElement('span');
    count.textContent = `${item.laps.length} ${item.mode === 'sprint' ? '次' : '圈'} ↗`;
    button.append(label, count);
    button.addEventListener('click', () => showHistory(item));
    list.append(button);
  }
  element('history-dialog').showModal();
}

function showHistory(item) {
  currentSessionView = item;
  element('history-detail').hidden = false;
  element('history-title').textContent = item.track;
  element('history-summary').textContent = `${item.laps.length} ${item.mode === 'sprint' ? '次' : '圈'} · 时长 ${formatTime(item.duration)} · ${item.samples.length} 个采样点 · 车辆数据：模拟`;
  element('history-track').querySelector('polyline').setAttribute('points', project(item.samples, 700, 240).map(point => point.join(',')).join(' '));
  element('history-laps').replaceChildren();
  if (!item.laps.length) element('history-laps').textContent = '本次没有完整成绩，轨迹和采样已保留。';
  for (const lap of item.laps) {
    const row = document.createElement('div'); row.className = 'replay-row';
    const name = document.createElement('span'); name.textContent = item.mode === 'sprint' ? '起点 → 终点' : `LAP ${String(lap.number).padStart(2, '0')}`;
    const time = document.createElement('span'); time.textContent = formatTime(lap.duration);
    row.append(name, time); element('history-laps').append(row);
  }
}

function mapFailure() {
  clearTimeout(mapsTimeout);
  mapsLoading = false;
  mapsFailed = true;
  setup.attach(null, '');
  mapboxMap?.remove();
  mapboxMap = null;
  mapboxCar = null;
  element('mapbox-map').hidden = true;
  element('track-map').removeAttribute('hidden');
  element('map-label').textContent = '赛道示意图 · 非真实地图';
  element('maps-status').textContent = '地图加载失败，请检查网络、公共 Token 和 URL 限制。修改 Token 后刷新页面重试。';
  notify('Mapbox 地图不可用，已保留示意图。模拟计圈仍可正常使用。');
}

function loadMapbox(key) {
  if (!key || mapboxMap || mapsLoading) return;
  if (mapsFailed) { element('maps-status').textContent = '新 Token 已保存。请刷新页面重新加载 Mapbox。'; return; }
  mapsLoading = true;
  element('maps-status').textContent = '正在加载 Mapbox…';
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.css';
  stylesheet.onerror = mapFailure;
  document.head.append(stylesheet);
  const script = document.createElement('script');
  script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.js';
  script.async = true;
  script.onload = () => {
    if (mapsFailed) return;
    try {
      element('mapbox-map').hidden = false;
      mapboxMap = new mapboxgl.Map({ container: 'mapbox-map', accessToken: key, style: 'mapbox://styles/mapbox/dark-v11', center: [gate[0].lng, gate[0].lat], zoom: 15, cooperativeGestures: true });
      mapboxMap.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      mapboxMap.on('error', event => {
        if (mapsLoading || [401, 403].includes(event.error?.status)) mapFailure();
      });
      mapboxMap.on('load', () => {
        if (mapsFailed || !mapboxMap) return;
        clearTimeout(mapsTimeout);
        for (const [id, color, width] of [['route', '#c9f76a', 4], ['gate', '#ffffff', 6], ['destination', '#fa977b', 6]]) {
          mapboxMap.addSource(id, { type: 'geojson', data: lineFeature([]) });
          mapboxMap.addLayer({ id, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': color, 'line-width': width } });
        }
        mapboxCar = new mapboxgl.Marker({ color: '#c9f76a', scale: 0.65 }).setLngLat([gate[0].lng, gate[0].lat]).addTo(mapboxMap);
        element('track-map').setAttribute('hidden', '');
        element('map-label').textContent = 'Mapbox · 演示路线为虚构';
        element('map-settings').textContent = '地图设置 ↗';
        element('maps-status').textContent = 'Mapbox 已连接。';
        mapsLoading = false;
        setup.attach(mapboxMap, key);
        drawMap(); fitMapboxMap();
      });
    } catch { mapFailure(); }
  };
  script.onerror = mapFailure;
  mapsTimeout = setTimeout(mapFailure, 15000);
  document.head.append(script);
}

element('record-button').addEventListener('click', () => running ? stopRecording() : startRecording());
for (const id of ['history-nav', 'history-button']) element(id).addEventListener('click', openHistory);
for (const id of ['settings-nav', 'map-settings']) element(id).addEventListener('click', () => element('settings-dialog').showModal());
element('live-nav').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
element('track-select').addEventListener('change', () => {
  track = tracks[Number(element('track-select').value)];
  gate = track.gate;
  customGate = false;
  finishGate = null;
  resetView();
});
function resetView(fit = true) {
  timer = new LapTimer(gate, finishGate);
  session = null;
  currentPoint = null;
  elapsed = 0;
  simulationTime = 0;
  chartSamples = [];
  renderLaps(); renderTiming(); drawMap(); if (fit) fitMapboxMap();
  renderTelemetry({ ...demoSample(0, track), rpm: 0, throttle: 0, brake: 0 });
  element('position-label').textContent = isGps() ? '手机 GPS · 等待开始' : '模拟定位 · 等待开始';
  element('timing-hint').textContent = '准备好，驶向下一次突破。';
}
element('source-select').addEventListener('change', () => {
  const config = setup.config();
  gate = isGps() && config.gate ? config.gate : track.gate;
  finishGate = isGps() ? config.finishGate : null;
  customGate = isGps() && config.ready;
  element('rate-select').parentElement.hidden = isGps();
  resetView();
  updateControls();
  notify(isGps() ? '搜索地点后点击地图设置起点。GPS 记录需要 HTTPS 和定位权限。车辆数据仍为模拟，后台将结束记录。' : '模拟 GPS 已就绪，点击开始记录即可试跑。');
});
element('gate-button').addEventListener('click', () => {
  if (!isGps()) { element('source-select').value = 'gps'; element('source-select').dispatchEvent(new Event('change')); }
  element('gps-settings').scrollIntoView({block: 'center'});
  element('place-query').focus();
});
element('maps-key').value = mapsKey;
element('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const key = element('maps-key').value.trim();
  if (key && !key.startsWith('pk.')) { element('maps-status').textContent = '请填写 pk. 开头的公共 Token，不要使用私密 Token。'; return; }
  try { localStorage.setItem('apex.mapboxToken', key); }
  catch { element('maps-status').textContent = '无法保存 Token，刷新后需要重新输入。'; }
  if (!key) { element('maps-status').textContent = 'Token 已清除。刷新页面将恢复示意图。'; return; }
  if (mapboxMap) { element('maps-status').textContent = 'Token 已保存，刷新页面后生效。'; return; }
  mapsKey = key;
  loadMapbox(key);
});
element('export-button').addEventListener('click', () => {
  if (!currentSessionView) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentSessionView, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `apex-${currentSessionView.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stopRecording('页面已切换到后台，本次记录已结束并保存。返回前台后可开始新的记录。');
});
window.addEventListener('pagehide', () => stopRecording());
for (let index = 0; index < 20; index++) element('rpm-bars').append(document.createElement('i'));
const setup = createMapSetup(config => {
  if (!isGps() || running) return;
  gate = config.gate || track.gate;
  finishGate = config.finishGate;
  customGate = config.ready;
  resetView(false);
});
resetView();
updateControls();
if (mapsKey) loadMapbox(mapsKey);
setInterval(tick, 250);
