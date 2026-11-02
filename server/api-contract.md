# Classification API contract (cloud AI mode)

In cloud mode the extension sends unclassified messages to a GreenClean API server whose base URL the user enters in the settings. This folder contains a reference implementation; any server that follows this contract works.

The extension only accepts `https://` base URLs, plus `http://localhost` and `http://127.0.0.1` for local development.

## Authentication

- Header: `Authorization: Bearer <token>`.
- The reference server accepts an HS256 JWT signed with `JWT_SECRET` (at least 32 characters), or one of the static tokens in `API_TOKENS`. Static tokens are compared in constant time.

## POST `{baseUrl}/v1/categorize`

Request:

```json
{
  "emails": [
    { "id": "gmailMessageId", "subject": "...", "snippet": "..." }
  ]
}
```

- `id` is required; `subject` and `snippet` are optional strings.
- At most `MAX_EMAILS_PER_REQUEST` items (default 30). The extension sends batches of 30.
- The extension truncates the subject to 180 characters and the snippet to 200 characters, and by default replaces email addresses with `[email]` and domain names with `[domain]`. The snippet is empty when the user turns it off.

Response (200):

```json
{
  "results": [
    { "id": "gmailMessageId", "category": "Disposable" }
  ]
}
```

- `category` is one of `Important`, `Neutral`, `Disposable`. The extension only acts on `Disposable`.
- Results with unknown IDs or categories are dropped by both the server and the extension.

Errors (JSON body with `error` and `requestId`):

| Status | Meaning |
|---|---|
| `400` | Invalid body or too many items |
| `401` | Missing or invalid token |
| `429` | Rate limit of this server (`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`, per IP) |
| `502` | The AI provider failed, timed out or returned unusable output. No provider detail is returned. |
| `503` | `ANTHROPIC_API_KEY` is not configured |

The extension retries `408`, `429`, `500`, `502`, `503` and `504` up to twice with exponential backoff.

## Data handling in the reference server

- It calls the Anthropic Messages API with the operator's key (`ANTHROPIC_API_KEY`, model `ANTHROPIC_MODEL`, default `claude-haiku-4-5`). The key never reaches the extension.
- It does not store requests and does not log subjects or snippets. Logs contain the request ID, the number of results, the auth type and, on provider failures, the upstream status code.

## CORS

Requests come from the extension popup (`chrome-extension://<id>`). Set `CORS_ORIGINS=chrome-extension://<id>`; unknown origins receive no CORS headers. With `NODE_ENV=production` the server refuses to start when `CORS_ORIGINS` is empty. In development an empty value allows any origin.

## Other endpoints

- `GET /health`: `{ ok, service, version, gitSha }`.
- `GET /ready`: `200` when an Anthropic key is configured, `503` otherwise.

## Running the reference server

```bash
cd server
npm ci
cp .env.example .env   # set ANTHROPIC_API_KEY and JWT_SECRET
npm start
npm test               # node:test suite
```

In the extension: Settings, "Cloud AI", URL `http://127.0.0.1:8787` locally (HTTPS in production), token from `npm run token:dev` or one of `API_TOKENS`.
