# GreenClean Privacy Policy

**Last updated:** November 2, 2026

This policy describes how the **GreenClean** extension ("we", "the extension") handles data when you use it in **Google Chrome** with **Gmail**.

## Data controller

**Pedro Henrique Fernandes**
**Contact (privacy and general questions):** [adm.nuvem@protonmail.com](mailto:adm.nuvem@protonmail.com)
**Alternative contact:** [pedromuska@gmail.com](mailto:pedromuska@gmail.com)

Source code: public repository **Hitice/greenclean** on GitHub.

## Purpose

The extension has a **single purpose**: helping you **organize and clean up your Gmail inbox**, with **human review** before messages are moved to Trash or subscriptions are cancelled. Your data is not used for advertising, credit scoring or anything unrelated to this purpose.

## Data involved

- **Google account and Gmail:** with your authorization (**OAuth**, scope `gmail.modify`), the extension uses the Gmail API to list messages, read their metadata (subject, sender, `List-Unsubscribe` header and Gmail's snippet), move the messages you confirm to Trash, and send the unsubscribe emails you request. Message bodies are not downloaded. Nothing is deleted permanently.
- **Classification:** heuristic rules run **on your device**. If you turn on AI classification, only the messages the rules did not classify are sent, and for each one only the Gmail message ID, the subject (up to 180 characters) and, unless you turn it off, the snippet (up to 200 characters). By default email addresses and domain names are masked before sending. The sender and the message body are never sent. They go to one of:
  - the **AI provider** you choose with your own API key (Google Gemini, OpenAI, Anthropic), or a local Ollama;
  - a **GreenClean API server whose address you enter yourself**. The extension has no default server; the operator of the server you configure (you, or whoever runs it) receives these requests.
- **Settings:** your preferences, API keys and cloud token are stored in the extension's `localStorage` on your device. The result of the last analysis (message IDs; sender and subject of the messages listed for review; sender, subject, snippet and unsubscribe header of detected subscriptions) is stored in `chrome.storage.local`. None of this is synced across devices or sent to us.

## Legal basis and consent

Processing is based on your **consent** (installing the extension and granting Chrome and Gmail permissions) and on **performing the service** you request. Access to an AI provider or to a cloud server is requested from Chrome only when you select it. You can revoke the extension's access in your Google account settings and in `chrome://extensions`.

## Sharing with third parties

- **Google (Gmail and OAuth):** under Google's applicable policies.
- **AI providers** (advanced mode only): data sent is handled under that provider's policies.
- **Cloud server** (cloud mode only, at the address you enter): its operator processes the requests the extension sends.
- **Unsubscribe actions** you run: the sender's unsubscribe page sees a visit from your browser, and a `mailto:` unsubscribe is an email sent from your account. Both tell the sender that the address is active.
- We **do not sell** personal data and do not share it for marketing.

The extension makes no analytics or telemetry requests, and its interface loads no resources from third-party servers.

## Retention

Cached results and settings stay **on your device** until you start a new analysis, return to the start screen, clear Chrome's storage or remove the extension. External providers apply **their own** retention policies to the requests they receive.

## Security

The extension uses Chrome's identity API and local storage; keys and tokens are entered by you and stay on your device. Connections to cloud servers must use HTTPS, except to `localhost` and `127.0.0.1`. You are never asked for your Google password outside the official OAuth flow.

## Your rights (GDPR and users in the EU)

Depending on your situation, you may have the right to **access**, **rectify**, **erase**, **restrict** or **object** to processing, and to **lodge a complaint** with a data protection authority. For data the extension keeps locally, clearing Chrome's data or removing the extension is the most direct way. For processing by Google, AI providers or the operator of a cloud server, contact them as well.

## Children

The extension is not directed at children under 16. Gmail is provided by Google under its own terms.

## Changes

This policy may be updated when the features or the law change. The date at the top shows the current version. Relevant changes will be reflected in the Chrome Web Store listing and in the public repository.

## Contact

For privacy questions or to exercise your rights: **adm.nuvem@protonmail.com** or **pedromuska@gmail.com**. Requests are answered within 30 days, depending on their complexity.

---

*This policy applies to the GreenClean extension. The code is licensed under AGPL-3.0; licensing and privacy are separate matters.*
