# Contrato da API de classificação (IA na nuvem)

A extensão, no plano **IA na nuvem**, chama o seu backend. Implemente no seu serviço.

## Autenticação

- Cabeçalho: `Authorization: Bearer <token>` (o usuário cola o token vindo do login no site de assinatura).

## POST `{baseUrl}/v1/categorize`

- **Request JSON:**
```json
{
  "emails": [
    { "id": "gmailMessageId", "subject": "...", "snippet": "..." }
  ]
}
```

- **Response JSON (200):**
```json
{
  "results": [
    { "id": "gmailMessageId", "category": "Disposable" }
  ]
}
```

- **category** é um de: `Important` | `Neutral` | `Disposable` (o cliente só soma `Disposable` como “descartável”).

- Erros: `401` token inválido, `402` cota/assinatura, `429` rate limit.

Cabe ao backend chamar Anthropic, OpenAI, etc., com as **chaves de vocês** — nunca expor isso na extensão pública.

## CORS

A requisição parte do **popup** da extensão (`chrome-extension://<id>`). O servidor precisa enviar `Access-Control-Allow-Origin` compatível (em dev pode usar o pacote `cors` com `origin: true`; em produção restrinja à origem da extensão com `CHROME_EXTENSION_ORIGIN` no servidor de exemplo).

## Implementação de referência

Ver pasta `server/`: `npm install` e `cp .env.example .env` em seguida `npm start`. Configurar na extensão: **Plano** → IA na nuvem, **URL** `http://127.0.0.1:8787` (HTTPS em produção), **token** um dos valores de `API_TOKENS` no `.env`.
