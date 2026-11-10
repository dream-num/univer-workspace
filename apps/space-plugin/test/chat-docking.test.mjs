import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dockChat,
  chatPlacementAt,
  constrainChat,
} from '../lib/chat-docking.js';

const bounds = { left: 340, top: 180, width: 940, height: 540 };
const size = { width: 572, height: 640 };
test('five release anchors stay inside the editor safe area', () => {
  for (const placement of [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom',
    'bottom-right',
  ]) {
    const frame = dockChat(placement, size, bounds);
    assert.ok(frame.left >= bounds.left + 10);
    assert.ok(frame.top >= bounds.top + 10);
    assert.ok(frame.left + frame.width <= bounds.left + bounds.width - 10);
    assert.ok(frame.top + frame.height <= bounds.top + bounds.height - 10);
  }
  assert.equal(dockChat('bottom', size, bounds).left, 524);
});
test('release uses pointer quadrant, with a bottom center hotspot', () => {
  for (const [x, y, placement] of [
    [345, 185, 'top-left'],
    [1275, 185, 'top-right'],
    [345, 450, 'bottom-left'],
    [1275, 450, 'bottom-right'],
    [810, 715, 'bottom'],
  ]) {
    assert.equal(chatPlacementAt(x, y, bounds), placement);
  }
});
test('resize and free drag cannot strand chat beyond a small editor', () => {
  for (const width of [0, 12, 100, 560]) {
    const area = { left: 30, top: 50, width, height: 300 };
    const frame = constrainChat({ left: -100, top: 2000, ...size }, area);
    assert.ok(frame.width >= 0 && frame.height >= 0);
    assert.ok(frame.left >= area.left);
    assert.ok(frame.top >= area.top);
    assert.ok(frame.left + frame.width <= area.left + width);
    assert.ok(frame.top + frame.height <= area.top + area.height);
  }
});

test('Canvas overlays and Pages tools reserve their measured edges', async () => {
  const { chatSafeArea } = await import('../lib/chat-docking.js');
  const viewport = { left: 340, top: 53, width: 940, height: 714 };
  const controls = [
    { left: 369, top: 185, width: 32, height: 32 },
    { left: 901, top: 82, width: 94, height: 32 },
    { left: 1074, top: 706, width: 32, height: 32 },
  ];
  const area = chatSafeArea(viewport, controls);
  for (const placement of [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom',
    'bottom-right',
  ]) {
    const frame = dockChat(placement, size, area);
    for (const c of controls)
      assert.ok(
        frame.left + frame.width <= c.left ||
          frame.left >= c.left + c.width ||
          frame.top + frame.height <= c.top ||
          frame.top >= c.top + c.height,
      );
  }
  assert.deepEqual(
    chatSafeArea(viewport, [{ left: 0, top: 0, width: 0, height: 0 }]),
    viewport,
  );
});

test('a wide Pages corner action reserves a top band and keeps bottom centering', async () => {
  const { chatSafeArea } = await import('../lib/chat-docking.js');
  const area = chatSafeArea({ left: 340, top: 53, width: 940, height: 714 }, [
    { left: 1160, top: 63, width: 110, height: 36 },
  ]);
  assert.equal(area.left, 340);
  assert.equal(area.width, 940);
  assert.equal(area.top, 107);
  assert.equal(dockChat('bottom', size, area).left, 524);
});
