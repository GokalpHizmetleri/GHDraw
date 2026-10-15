const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('text AI properties expose correction only and submit a correction request', () => {
  const start = html.indexOf('if(aiSelection()){');
  const end = html.indexOf('\nfunction setProp(', start);
  assert.ok(start >= 0 && end > start, 'text AI controls and modal must exist');
  const feature = html.slice(start, end);

  assert.match(feature, /Yazımı düzelt/);
  assert.match(feature, /op:'correct'/);
  assert.doesNotMatch(feature, /translate|çevir|target language|aiLanguage/i);
});
