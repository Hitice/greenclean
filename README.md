# GreenClean

> Intelligent, privacy-first Gmail inbox management — as a Chrome Extension.

GreenClean uses a multi-stage pipeline (Gmail categories → heuristic rules → optional AI) to identify and remove disposable emails from your inbox. All processing runs locally in the browser. No data is sent to any external server beyond the AI provider you choose.

---

## How It Works

```
Gmail Inbox (all messages)
        │
        ├─ category:promotions  ──► Flag for deletion (IDs only, no detail fetch)
        ├─ category:social      ──► Flag for deletion (IDs only)
        ├─ category:updates     ──► Flag for deletion (IDs only)
        │
        └─ category:primary
                │
                ├─ Heuristic Classifier ──► Catches obvious spam by subject/sender/snippet patterns
                │                          Detects mailing list subscriptions (List-Unsubscribe header)
                │
                └─ AI Classifier (optional) ──► Deeper analysis on remaining emails
                        │
                        └─ Supported providers:
                              • Google Gemini (2.5 Flash, with auto-fallback)
                              • OpenAI ChatGPT (gpt-4o-mini or custom)
                              • Anthropic Claude (claude-3-haiku or custom)
                              • Ollama (fully local — no API key required)
```

The user reviews results **by category** and selects what to delete — nothing is removed automatically.

---

## Installation

### 1. Prerequisites
- Google Chrome or Chromium browser
- A Google Cloud Project with the **Gmail API** enabled
- An AI provider API key (optional — heuristic mode works without AI)

### 2. Clone and Build

```bash
git clone <repository-url>
cd GreenClean
npm install
npm run build
```

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` directory

---

## Configuration

### Google OAuth2 (required)

The extension authenticates via Chrome's native identity API — no manual login flow.

You must register a **Chrome Extension** OAuth2 client in Google Cloud Console:

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create → **OAuth client ID** → **Chrome Extension**
3. Enter your extension's ID (visible at `chrome://extensions/`)
4. Copy the generated **Client ID**
5. Paste it into `manifest.json`:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/gmail.modify"]
}
```

6. Rebuild: `npm run build && cp manifest.json dist/manifest.json`
7. Enable **Gmail API** in your project: [Gmail API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com)

### AI Provider (optional)

Open the **Config** panel in the extension and select a provider:

| Provider | Key required | Notes |
|---|---|---|
| Google Gemini | Yes | Free tier available at [ai.google.dev](https://ai.google.dev) |
| OpenAI ChatGPT | Yes | `gpt-4o-mini` recommended for cost efficiency |
| Anthropic Claude | Yes | `claude-3-haiku-20240307` recommended |
| Ollama (Local) | No | Requires [Ollama](https://ollama.com) running locally |

All keys are stored only in the browser's `localStorage`. They are never transmitted to this extension's servers (there are none).

---

## Classification Pipeline

### Stage 1 — Gmail Native Categories (fastest)
Fetches only message IDs (no content) for Promotions, Social, and Updates categories. Zero detail requests, zero AI usage.

### Stage 2 — Heuristic Pre-Classifier
Runs locally on email subject, sender, and snippet before invoking AI:

- **Subject patterns**: promotional keywords, discount indicators, notification patterns (PT-BR and EN)
- **Sender patterns**: `noreply`, `newsletter`, `marketing`, `notifications@`, etc.
- **Subscription detection**: emails containing `List-Unsubscribe` headers are surfaced separately for review

### Stage 3 — AI Classifier (optional)
Only emails that pass through stages 1–2 unclassified are sent to the AI in batches of 30. This minimizes API token usage.

---

## Security and Integrity

The codebase can be verified locally before loading into Chrome:

```powershell
# PowerShell — SHA-256 checksums of core modules
Get-FileHash src/main.js, src/gmail.js, src/ai.js, src/classifier.js, manifest.json | Format-Table Hash, Path
```

Compare these against the published release hashes in [RELEASES.md](./RELEASES.md) to confirm the build has not been tampered with.

---

## Development

```bash
npm run dev      # Start local dev server (Vite)
npm run build    # Production build → dist/
```

After each build, copy extension assets manually:

```powershell
npm run build
cp manifest.json dist/manifest.json
cp public/logo.svg dist/logo.svg
cp public/favicon.svg dist/favicon.svg
```

Or add a `postbuild` script to `package.json` to automate this.

---

## Project Structure

```
GreenClean/
├── dist/              # Production build (load this in Chrome)
├── public/
│   ├── logo.svg       # Extension logo (transparent background)
│   └── favicon.svg    # Favicon
├── src/
│   ├── ai.js          # Multi-provider AI engine (Gemini, OpenAI, Claude, Ollama)
│   ├── classifier.js  # Heuristic pre-classifier (no AI required)
│   ├── gmail.js       # Gmail REST API wrapper (pagination, batch fetch, trash)
│   ├── main.js        # Application controller and UI logic
│   └── style.css      # All styles (white + green theme)
├── index.html         # Extension popup markup
└── manifest.json      # Chrome Extension Manifest V3
```

---

## License

MIT License. Open source. Auditable. No telemetry.
