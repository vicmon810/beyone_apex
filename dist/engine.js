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


export const tracks = [];

export function createCustomTrack(points, name, mode = 'lap') {
  if (!Array.isArray(points) || points.length < 2 || points.length > 5000 || !points.every(validPoint)) throw new Error('Invalid path');
  const path = points.map(p => ({lat:p.lat, lng:p.lng}));
  if (mode === 'lap' && distance(path[0],path.at(-1)) > 5) path.push({...path[0]});
  const length = path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0);
  if (length < 50) throw new Error('Path must be at least 50 m');
  const a=path[0], b=path[1], angle=Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI;
  return {id:'custom',name,subtitle:'SAVED / CUSTOM ROUTE',path,length,gate:gateFromPoint(a,(angle+360)%180)};
}

export function demoSample(time, track) {
  const lapDuration = track ? Math.max(20,track.length / (60/3.6)) : 60;
  const progress = ((time/lapDuration)%1+1)%1;
  let lat=0,lng=0,speed=0;
  if(track){
    const segments=track.path.slice(1).map((p,i)=>distance(track.path[i],p));
    let remaining=progress*track.length,i=0;
    while(i<segments.length-1 && remaining>segments[i]) remaining-=segments[i++];
    const fraction=segments[i] ? Math.min(1,remaining/segments[i]) : 0;
    const a=track.path[i],b=track.path[i+1];
    lat=a.lat+(b.lat-a.lat)*fraction;lng=a.lng+(b.lng-a.lng)*fraction;
    speed=track.length/lapDuration*3.6;
  }
  const brake=Math.max(0,Math.sin(progress*Math.PI*8)-0.4)*100;
  const throttle=brake>5?4:65+Math.sin(progress*Math.PI*6)*28;
  return {time,lat,lng,accuracy:0,speed,rpm:3200+throttle*39,coolant:87+Math.sin(time/35)*3,throttle,brake,progress};
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
