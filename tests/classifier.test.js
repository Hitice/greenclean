import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic, classifyBatch } from '../src/classifier.js';

test('classifica como assinatura quando há List-Unsubscribe', () => {
  const result = classifyHeuristic({
    subject: 'Atualização semanal',
    snippet: 'Conteúdo da newsletter.',
    from: 'news@example.com',
    unsubscribeHeader: '<https://example.com/unsub>',
  });
  assert.equal(result, 'Subscription');
});

test('nao marca invoice como descartavel automaticamente', () => {
  const result = classifyHeuristic({
    subject: 'Invoice #1902',
    snippet: 'Segue o comprovante da sua compra.',
    from: 'billing@empresa.com',
    unsubscribeHeader: '',
  });
  assert.equal(result, null);
});

test('classifyBatch separa descartaveis, assinaturas e pendentes', () => {
  const emails = [
    { id: '1', subject: '50% off hoje', snippet: 'oferta limitada', from: 'promo@shop.com', unsubscribeHeader: '' },
    { id: '2', subject: 'Weekly update', snippet: 'unsubscribe here', from: 'news@site.com', unsubscribeHeader: '' },
    { id: '3', subject: 'Reunião amanhã', snippet: 'confirmação de horário', from: 'pessoa@empresa.com', unsubscribeHeader: '' },
  ];

  const result = classifyBatch(emails);
  assert.equal(result.disposable.length, 1);
  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.needsAI.length, 1);
});
