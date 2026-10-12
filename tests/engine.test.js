import test from 'node:test';
import assert from 'node:assert/strict';
import { LapTimer, crossing, demoSample, formatTime, tracks } from '../dist/engine.js';

test('formats lap time without rounding into invalid seconds', () => {
  assert.equal(formatTime(59.9999), '00:59.999');
  assert.equal(formatTime(78.125), '01:18.125');
  assert.equal(formatTime(null), '—');
});

test('crossing needs a finite gate and returns interpolated direction', () => {
  const gate = [{ lat: 0, lng: -1 }, { lat: 0, lng: 1 }];
  assert.deepEqual(crossing({ lat: -1, lng: 0 }, { lat: 3, lng: 0 }, gate), { fraction: 0.25, direction: 1 });
  assert.equal(crossing({ lat: -1, lng: 2 }, { lat: 1, lng: 2 }, gate), null);
  assert.equal(crossing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, gate), null);
});

test('both demo tracks complete accurate laps through the shared GPS timer', () => {
  for (const track of tracks) {
    const timer = new LapTimer(track.gate);
    for (let step = -1; step <= 660; step++) timer.add(demoSample(step / 4, track));
    assert.equal(timer.laps.length, 2);
    assert.ok(Math.abs(timer.laps[0].duration - (track.id === '0' ? 78 : 65)) < 0.01);
  }
});

test('rejects inaccurate fixes, stale timestamps, GPS jumps and long gaps', () => {
  const timer = new LapTimer(tracks[0].gate);
  timer.add(demoSample(-0.25, tracks[0]));
  timer.add(demoSample(0.25, tracks[0]));
  assert.ok(timer.startedAt !== null);
  timer.add(demoSample(0.1, tracks[0]));
  assert.equal(timer.previous.time, 0.25);
  timer.add({ ...demoSample(1, tracks[0]), accuracy: 80 });
  assert.equal(timer.previous, null);
  timer.add(demoSample(2, tracks[0]));
  timer.add(demoSample(10, tracks[0]));
  assert.equal(timer.startedAt, null);
  timer.startedAt = 10;
  timer.add({ ...demoSample(11, tracks[0]), lat: 0 });
  assert.equal(timer.startedAt, null);
  assert.equal(timer.laps.length, 0);
});

test('finish-line jitter cannot create laps', () => {
  const timer = new LapTimer([{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }]);
  for (let time = 0; time < 60; time++) timer.add({ lat: time % 2 ? 0.000001 : -0.000001, lng: 0, time, accuracy: 5 });
  assert.equal(timer.laps.length, 0);
});

const startGate = [{lat: 0, lng: -0.0002}, {lat: 0, lng: 0.0002}];
const endGate = [{lat: 0.001, lng: 0.0002}, {lat: 0.001, lng: -0.0002}];
const fix = (lat, time, extra = {}) => ({lat, lng: 0, time, accuracy: 5, ...extra});

test('point-to-point waits for start, finishes at independent finish direction, then freezes', () => {
  const timer = new LapTimer(startGate, endGate);
  timer.add(fix(-0.0001, 0));
  assert.equal(timer.startedAt, null);
  timer.add(fix(0.0001, 1));
  assert.equal(timer.startedAt, 0.5);
  timer.add(fix(0.0005, 3));
  timer.add(fix(0.0009, 5));
  const result = timer.add(fix(0.0011, 6));
  assert.ok(result);
  assert.ok(Math.abs(result.duration - 5) < 1e-9);
  assert.equal(timer.finishedAt, 5.5);
  timer.add(fix(0.0009, 7));
  timer.add(fix(0.0011, 8));
  assert.equal(timer.laps.length, 1);
});

test('finish before start and crossing outside the finite finish line do not finish', () => {
  const timer = new LapTimer(startGate, endGate);
  timer.add(fix(0.0009, 0));
  timer.add(fix(0.0011, 1));
  assert.equal(timer.laps.length, 0);
  const armed = new LapTimer(startGate, endGate);
  armed.add(fix(-0.0001, 0)); armed.add(fix(0.0001, 1));
  armed.add(fix(0.0009, 4, {lng: 0.0004}));
  armed.add(fix(0.0011, 5, {lng: 0.0004}));
  assert.equal(armed.laps.length, 0);
});

test('unreliable GPS invalidates point-to-point timing until another start crossing', () => {
  const timer = new LapTimer(startGate, endGate);
  timer.add(fix(-0.0001, 0)); timer.add(fix(0.0001, 1));
  timer.add(fix(0.0005, 2, {accuracy: 50}));
  assert.equal(timer.startedAt, null);
  timer.add(fix(0.0009, 3)); timer.add(fix(0.0011, 4));
  assert.equal(timer.laps.length, 0);
});

test('start and finish in one valid GPS interval use interpolated times', () => {
  const timer = new LapTimer(startGate, endGate);
  timer.add(fix(-0.0001, 0));
  const result = timer.add(fix(0.0011, 2));
  assert.ok(result);
  assert.ok(Math.abs(result.duration - 2 / 1.2) < 1e-9);
});

test('one pin generates a finite 30 metre line perpendicular to heading', async () => {
  const { gateFromPoint, validPoint } = await import('../dist/engine.js');
  assert.equal(typeof gateFromPoint, 'function');
  const center = {lat: -37, lng: 175};
  const eastWest = gateFromPoint(center, 0);
  const northSouth = gateFromPoint(center, 90);
  assert.ok(Math.abs(eastWest[0].lat - center.lat) < 1e-9);
  assert.ok(Math.abs(northSouth[0].lng - center.lng) < 1e-9);
  const { distance } = await import('../dist/engine.js');
  assert.ok(Math.abs(distance(...eastWest) - 30) < 0.01);
  assert.equal(validPoint({lat: NaN, lng: 0}), false);
  assert.equal(validPoint({lat: 90, lng: 0}), false);
  assert.throws(() => gateFromPoint(center, NaN));
});
