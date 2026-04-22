import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnsubscribeHeader, buildUnsubscribeItems } from '../src/unsubscriber.js';

test('parseUnsubscribeHeader separa links http e mailto', () => {
  const parsed = parseUnsubscribeHeader('<https://example.com/unsub>, <mailto:leave@example.com?subject=unsubscribe>');
  assert.equal(parsed.httpUrl, 'https://example.com/unsub');
  assert.equal(parsed.mailtoUrl, 'leave@example.com?subject=unsubscribe');
});

test('buildUnsubscribeItems descarta itens sem header de unsubscribe', () => {
  const items = buildUnsubscribeItems([
    { id: '1', from: 'A', subject: 'X', unsubscribeHeader: '<https://example.com/unsub>' },
    { id: '2', from: 'B', subject: 'Y', unsubscribeHeader: '' },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, '1');
  assert.equal(items[0].httpUrl, 'https://example.com/unsub');
});
