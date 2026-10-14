import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/function widgetStartPosition\(k,width=innerWidth,height=innerHeight\)\{[\s\S]*?\n\}/);
assert.ok(match, 'widgetStartPosition must remain available in index.html');

function position(k, width, height) {
  const context = { innerWidth: width, innerHeight: height };
  vm.runInNewContext(`${match[0]}; globalThis.__widgetStartPosition = widgetStartPosition;`, context);
  const p = context.__widgetStartPosition(k, width, height);
  return { left: p.left, top: p.top };
}

for (const [width, height] of [[390, 844], [390, 320], [390, 120], [768, 1024], [1440, 900]]) {
  test(`all four widget headers get distinct, reachable starting positions at ${width}x${height}`, () => {
    const positions = ['clock', 'cal', 'timer', 'todo'].map(k => position(k, width, height));
    assert.equal(new Set(positions.map(p => `${p.left},${p.top}`)).size, 4);
    assert.ok(positions.every(p => p.left >= 8 && p.left <= Math.max(8, width - 260)));
    assert.ok(positions.every(p => p.top >= 8 && p.top <= Math.max(8, height - 48)));
  });
}
