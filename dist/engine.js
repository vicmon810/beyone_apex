export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const milliseconds = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

export function distance(first, second) {
  const latitude = (first.lat + second.lat) * Math.PI / 360;
  return Math.hypot((second.lng - first.lng) * Math.cos(latitude), second.lat - first.lat) * 111195;
}

export function crossing(previous, current, gate) {
  const [start, end] = gate;
  const side = point => (end.lng - start.lng) * (point.lat - start.lat) - (end.lat - start.lat) * (point.lng - start.lng);
  const before = side(previous);
  const after = side(current);
  if (before === 0 || before * after > 0) return null;
  const fraction = before / (before - after);
  const intersection = { lat: previous.lat + (current.lat - previous.lat) * fraction, lng: previous.lng + (current.lng - previous.lng) * fraction };
  const lengthSquared = (end.lat - start.lat) ** 2 + (end.lng - start.lng) ** 2;
  if (!lengthSquared) return null;
  const along = ((intersection.lat - start.lat) * (end.lat - start.lat) + (intersection.lng - start.lng) * (end.lng - start.lng)) / lengthSquared;
  return along >= 0 && along <= 1 ? { fraction, direction: Math.sign(after - before) } : null;
}

export class LapTimer {
  constructor(gate, finishGate = null) {
    this.finishGate = finishGate;
    this.finishedAt = null;
    this.gate = gate;
    this.previous = null;
    this.startedAt = null;
    this.direction = null;
    this.travelled = 0;
    this.laps = [];
  }

  add(point) {
    if (this.finishedAt !== null) return null;
    if (![point.lat, point.lng, point.time, point.accuracy].every(Number.isFinite) || point.accuracy < 0 || point.accuracy > 30 || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      this.previous = null;
      this.startedAt = null;
      this.travelled = 0;
      return null;
    }
    const previous = this.previous;
    if (previous && point.time <= previous.time) return null;
    this.previous = point;
    if (!previous) return null;
    const interval = point.time - previous.time;
    const movement = distance(previous, point);
    if (interval > 5 || movement / interval > 120) {
      this.startedAt = null;
      this.travelled = 0;
      return null;
    }
    this.travelled += movement;
    if (this.finishGate) {
      if (this.startedAt === null) {
        const start = crossing(previous, point, this.gate);
        if (!start) return null;
        this.startedAt = previous.time + interval * start.fraction;
      }
      const finish = crossing(previous, point, this.finishGate);
      if (!finish) return null;
      const endedAt = previous.time + interval * finish.fraction;
      if (endedAt <= this.startedAt) return null;
      this.finishedAt = endedAt;
      const result = { number: 1, duration: endedAt - this.startedAt, endedAt };
      this.laps.push(result);
      return result;
    }
    const hit = crossing(previous, point, this.gate);
    if (!hit || (this.direction !== null && hit.direction !== this.direction)) return null;
    const time = previous.time + interval * hit.fraction;
    if (this.startedAt === null) {
      this.startedAt = time;
      this.direction = hit.direction;
      this.travelled = 0;
      return null;
    }
    const duration = time - this.startedAt;
    if (duration < 10 || this.travelled < 100) return null;
    const lap = { number: this.laps.length + 1, duration, endedAt: time };
    this.laps.push(lap);
    this.startedAt = time;
    this.travelled = 0;
    return lap;
  }
}

const shapes = [
  [[150, 250], [190, 145], [300, 95], [470, 90], [590, 135], [610, 215], [550, 260], [460, 240], [405, 290], [465, 350], [395, 395], [250, 375], [180, 320], [150, 250]],
  [[155, 245], [210, 130], [365, 105], [550, 145], [600, 265], [510, 365], [370, 365], [330, 275], [245, 315], [175, 300], [155, 245]]
];

export const tracks = shapes.map((shape, index) => {
  const path = shape.map(([horizontal, vertical]) => ({ lat: -37.35 - (vertical - 240) / 90000, lng: 175.08 + (horizontal - 380) / 72000 }));
  const origin = path[0];
  const next = path[1];
  const deltaLat = next.lat - origin.lat;
  const deltaLng = next.lng - origin.lng;
  const length = Math.hypot(deltaLat, deltaLng);
  const gate = [-1, 1].map(sign => ({ lat: origin.lat + sign * deltaLng / length * 0.00025, lng: origin.lng - sign * deltaLat / length * 0.00025 }));
  return { id: String(index), name: index ? '林地短道' : '海湾环线', subtitle: index ? 'WOODLAND / DEMO CIRCUIT' : 'HARBOUR / DEMO CIRCUIT', path, shape, gate, length: path.slice(1).reduce((sum, point, position) => sum + distance(path[position], point), 0) };
});

export function demoSample(time, track) {
  const lapDuration = track.id === '0' ? 78 : 65;
  const progress = ((time / lapDuration) % 1 + 1) % 1;
  const lengths = track.path.slice(1).map((point, index) => distance(track.path[index], point));
  let remaining = progress * track.length;
  let segment = 0;
  while (segment < lengths.length - 1 && remaining > lengths[segment]) remaining -= lengths[segment++];
  const fraction = remaining / lengths[segment];
  const start = track.path[segment];
  const end = track.path[segment + 1];
  const brake = Math.max(0, Math.sin(progress * Math.PI * 8) - 0.4) * 100;
  const throttle = brake > 5 ? 4 : 65 + Math.sin(progress * Math.PI * 6) * 28;
  const speed = track.length / lapDuration * 3.6;
  return { time, lat: start.lat + (end.lat - start.lat) * fraction, lng: start.lng + (end.lng - start.lng) * fraction, accuracy: 0, speed, rpm: 3200 + throttle * 39, coolant: 87 + Math.sin(time / 35) * 3, throttle, brake, progress };
}

export function validPoint(point) {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) < 85 && Math.abs(point.lng) <= 180;
}

export function gateFromPoint(point, heading) {
  if (!validPoint(point) || !Number.isFinite(heading)) throw new Error('Invalid timing point');
  const angle = heading * Math.PI / 180;
  return [-1, 1].map(sign => ({
    lat: point.lat - sign * Math.sin(angle) * 15 / 111195,
    lng: ((point.lng + sign * Math.cos(angle) * 15 / (111195 * Math.cos(point.lat * Math.PI / 180)) + 540) % 360) - 180
  }));
}
