import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTrashCandidates, toPreviewItem } from '../src/scan-results.js';

const results = {
  promotions: {
    disposableIds: ['1', '2'],
    disposableItems: [
      { id: '1', from: 'Shop <deals@shop.example>', subject: '50% off' },
      { id: '2', from: 'News <news@site.example>', subject: 'Weekly' },
    ],
  },
  social: { disposableIds: ['3', '1'], disposableItems: [{ id: '3', from: 'Net', subject: 'New follower' }] },
  updates: { disposableIds: ['9'] },
};

test('collectTrashCandidates lists only selected categories, once per message', () => {
  const items = collectTrashCandidates(results, ['promotions', 'social']);
  assert.deepEqual(items.map((i) => i.id), ['1', '2', '3']);
  assert.equal(items[0].from, 'Shop <deals@shop.example>');
  assert.equal(items[2].category, 'social');
  assert.deepEqual(collectTrashCandidates(results, []), []);
});

test('collectTrashCandidates keeps sessions saved without details', () => {
  const [item] = collectTrashCandidates(results, ['updates', 'missing']);
  assert.deepEqual(item, { id: '9', category: 'updates', from: '', subject: '', hasDetails: false });
});

test('toPreviewItem keeps only id, sender and a clipped subject', () => {
  const item = toPreviewItem({ id: 7, from: 'A  <a@b.example>', subject: 'x'.repeat(300), snippet: 'secret' });
  assert.deepEqual(Object.keys(item), ['id', 'from', 'subject']);
  assert.equal(item.id, '7');
  assert.equal(item.from, 'A <a@b.example>');
  assert.equal(item.subject.length, 140);
});
