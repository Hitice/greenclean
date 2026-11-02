import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnsubscribeHeader, buildUnsubscribeItems, buildMailtoUnsubscribeMessage } from '../src/unsubscriber.js';

function headerLines(message) {
  return message.split('\r\n\r\n')[0].split('\r\n');
}

test('buildMailtoUnsubscribeMessage usa assunto do mailto ou padrao', () => {
  assert.deepEqual(headerLines(buildMailtoUnsubscribeMessage('leave@example.com?subject=Remove%20me')).slice(0, 2), [
    'To: leave@example.com',
    'Subject: Remove me',
  ]);
  assert.equal(headerLines(buildMailtoUnsubscribeMessage('leave@example.com'))[1], 'Subject: Unsubscribe');
});

test('buildMailtoUnsubscribeMessage remove quebra de linha do assunto (sem injecao de cabecalho)', () => {
  const message = buildMailtoUnsubscribeMessage('leave@example.com?subject=x%0D%0ABcc:%20victim@example.org%0D%0A%0D%0Aspam');
  const headers = headerLines(message);
  assert.ok(headers.every((line) => !/^bcc:/i.test(line)));
  assert.equal(headers.filter((line) => line.startsWith('Subject:')).length, 1);
  assert.ok(message.endsWith('\r\n\r\nPlease unsubscribe me from this mailing list.'));
});

test('buildMailtoUnsubscribeMessage rejeita mais de um destinatario ou endereco com CRLF', () => {
  assert.throws(() => buildMailtoUnsubscribeMessage('a@example.com,b@example.org'));
  assert.throws(() => buildMailtoUnsubscribeMessage('a@example.com%0D%0ABcc:b@example.org'));
  assert.throws(() => buildMailtoUnsubscribeMessage(''));
});

test('buildMailtoUnsubscribeMessage codifica assunto nao ASCII', () => {
  const subject = headerLines(buildMailtoUnsubscribeMessage('leave@example.com?subject=D%C3%A9sabonner'))[1];
  assert.equal(subject, `Subject: =?UTF-8?B?${Buffer.from('Désabonner').toString('base64')}?=`);
});

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
