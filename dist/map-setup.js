import { distance, gateFromPoint, validPoint } from './engine.js';

// Venue centres only; the driver places the timing line on the chosen circuit layout.
const circuits = {
  hampton: {name: 'Hampton Downs', center: [175.07528, -37.35389]},
  taupo: {name: 'Taupō Motorsport Park', center: [176.14417, -38.66556]},
  manfeild: {name: 'Manfeild · Circuit Chris Amon', center: [175.55722, -40.2375]}
};

const el = id => document.getElementById(id);

export function createMapSetup(onChange) {
  let map = null;
  let key = '';
  let enabled = false;
  let locked = false;
  let target = 'start';
  let state = { mode: 'lap', start: null, finish: null, startHeading: 0, finishHeading: 0 };
  const markers = {};
  let searchController = null;
  try {
    const saved = JSON.parse(localStorage.getItem('apex.timingSetup.v1'));
    if (saved && ['lap', 'sprint'].includes(saved.mode) && ['start', 'finish'].every(name => saved[name] === null || validPoint(saved[name])) && ['startHeading', 'finishHeading'].every(name => Number.isFinite(saved[name]) && saved[name] >= 0 && saved[name] < 180)) state = saved;
  } catch { /* Unavailable or invalid saved setup leaves the map ready for new pins. */ }

  function config() {
    const gate = state.start ? gateFromPoint(state.start, state.startHeading) : null;
    const finishGate = state.mode === 'sprint' && state.finish ? gateFromPoint(state.finish, state.finishHeading) : null;
    const ready = !!gate && (state.mode === 'lap' || (!!finishGate && distance(state.start, state.finish) >= 50));
    const circuit = state.start && Object.values(circuits).find(item => distance(state.start, {lng:item.center[0], lat:item.center[1]}) < 5000);
    return { mode: state.mode, gate, finishGate, ready, name: circuit ? circuit.name : '自定义 GPS 赛道' };
  }

  function render() {
    el('timing-mode').value = state.mode;
    el('set-finish').hidden = state.mode !== 'sprint';
    el('finish-heading-label').hidden = state.mode !== 'sprint';
    for (const name of ['start', 'finish']) {
      el(`${name}-heading`).value = state[`${name}Heading`];
      el(`${name}-degrees`).textContent = `${state[`${name}Heading`]}°`;
      el(`set-${name}`).setAttribute('aria-pressed', String(target === name));
      const visible = enabled && state[name] && (name === 'start' || state.mode === 'sprint');
      if (map && visible) {
        if (!markers[name]) {
          const pin = document.createElement('div');
          pin.className = `timing-pin ${name}`;
          pin.textContent = name === 'start' ? 'A' : 'B';
          pin.addEventListener('click', event => event.stopPropagation());
          pin.setAttribute('aria-label', name === 'start' ? '起点' : '终点');
          markers[name] = new mapboxgl.Marker({ element: pin, draggable: !locked }).setLngLat([state[name].lng, state[name].lat]).addTo(map);
          markers[name].on('dragend', () => {
            const point = markers[name].getLngLat();
            place(name, { lat: point.lat, lng: point.lng });
          });
        }
        markers[name].setLngLat([state[name].lng, state[name].lat]).setDraggable(!locked);
      } else if (markers[name]) { markers[name].remove(); delete markers[name]; }
    }
    el('gps-settings').hidden = !enabled;
    el('gps-settings').disabled = locked;
    const ready = config().ready;
    el('setup-status').textContent = !state.start ? '点击地图放置起点 A，图钉可拖动。' : state.mode === 'sprint' && !state.finish ? '起点已设置，点击地图放置终点 B。' : !ready ? '起终点至少相距 50 米，请移动图钉。' : state.mode === 'sprint' ? '起终点已就绪。经过 A 开始，经过 B 自动结束保存。' : '起点已就绪。首次过线开始，再次同向过线计圈。';
    if (map) map.getCanvas().style.cursor = enabled && !locked ? 'crosshair' : '';
  }

  function changed() {
    render();
    try { localStorage.setItem('apex.timingSetup.v1', JSON.stringify(state)); }
    catch { el('setup-status').textContent += ' 设置无法保存，刷新后需重设。'; }
    onChange(config());
  }

  function place(name, point) {
    if (locked || !enabled || !validPoint(point)) return;
    const firstPair = !state.start || !state.finish;
    state[name] = point;
    if (firstPair && state.mode === 'sprint' && state.start && state.finish) {
      const angle = Math.atan2((state.finish.lng - state.start.lng) * Math.cos(state.start.lat * Math.PI / 180), state.finish.lat - state.start.lat) * 180 / Math.PI;
      const heading = (Math.round(angle / 5) * 5 + 360) % 180;
      state.startHeading = heading;
      state.finishHeading = heading;
    }
    if (name === 'start' && state.mode === 'sprint' && !state.finish) target = 'finish';
    changed();
  }

  el('timing-mode').addEventListener('change', () => {
    state.mode = el('timing-mode').value;
    target = state.mode === 'sprint' && state.start && !state.finish ? 'finish' : 'start';
    changed();
  });
  for (const name of ['start', 'finish']) {
    el(`set-${name}`).addEventListener('click', () => { target = name; render(); el('setup-status').textContent = `点击地图设置${name === 'start' ? '起点 A' : '终点 B'}，或使用地图中心。`; });
    el(`${name}-heading`).addEventListener('input', () => { state[`${name}Heading`] = Number(el(`${name}-heading`).value); changed(); });
  }
  el('nz-circuit').addEventListener('change', () => {
    const circuit = circuits[el('nz-circuit').value];
    if (!circuit) return;
    if (!map) { el('setup-status').textContent = '请先连接 Mapbox，再选择赛道。'; return; }
    state.start = null; state.finish = null;
    target = 'start';
    changed();
    map.flyTo({center: circuit.center, zoom: 15});
    el('setup-status').textContent = `${circuit.name}：已定位赛道区域，请点击实际起点。`;
  });
  el('use-center').addEventListener('click', () => {
    if (!map) { el('setup-status').textContent = '请先在地图设置中连接 Mapbox。'; return; }
    const point = map.getCenter();
    place(target, {lat: point.lat, lng: point.lng});
  });

  el('place-search').addEventListener('submit', async event => {
    event.preventDefault();
    const query = el('place-query').value.trim();
    if (!query || locked) return;
    if (!map || !key) { el('search-status').textContent = '请先在地图设置中连接 Mapbox，再搜索地点。'; return; }
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    el('search-results').replaceChildren();
    el('search-status').textContent = '正在搜索…';
    try {
      const params = new URLSearchParams({ q: query, access_token: key, limit: '5' });
      const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`, {signal: controller.signal});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '搜索未获授权，请检查 Mapbox Token、账号及网址限制。' : '搜索暂不可用，请稍后重试。');
      const data = await response.json();
      if (searchController !== controller || locked || !enabled || !map) return;
      const features = Array.isArray(data.features) ? data.features.filter(feature => feature.geometry?.type === 'Point' && validPoint({lng: feature.geometry.coordinates?.[0], lat: feature.geometry.coordinates?.[1]})) : [];
      el('search-status').textContent = features.length ? '选择结果查看地图，再点一下放置起点或终点。' : '没有找到地点，请尝试附近地址、城市，或直接拖动地图选点。';
      for (const feature of features) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = typeof feature.properties?.name === 'string' ? feature.properties.name : query;
        const address = document.createElement('small');
        address.textContent = feature.properties?.full_address || feature.properties?.place_formatted || '';
        button.append(address);
        button.addEventListener('click', () => {
          if (!map || locked) return;
          map.flyTo({center: feature.geometry.coordinates, zoom: 16});
          el('search-results').replaceChildren();
          el('search-status').textContent = '已移到目标区域，请在道路上点击放置图钉。';
        });
        el('search-results').append(button);
      }
    } catch (error) {
      if (searchController === controller) el('search-status').textContent = error.name === 'AbortError' ? '搜索已取消或超时，请重试。' : error.message === 'Failed to fetch' ? '搜索连接失败，请检查网络后重试。' : error.message;
    } finally { clearTimeout(timeout); }
  });

  render();
  return {
    config,
    attach(nextMap, token) {
      for (const marker of Object.values(markers)) marker.remove();
      for (const name of Object.keys(markers)) delete markers[name];
      map = nextMap; key = token;
      if (!map) { searchController?.abort(); searchController = null; el('search-results').replaceChildren(); }
      if (map) map.on('click', event => { if (event.lngLat) place(target, {lat: event.lngLat.lat, lng: event.lngLat.lng}); });
      render();
    },
    update(active, recording) {
      enabled = active; locked = recording;
      if (!enabled || locked) { searchController?.abort(); searchController = null; el('search-results').replaceChildren(); }
      render();
    }
  };
}
