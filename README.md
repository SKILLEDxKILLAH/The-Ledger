<div align="center">

# The Ledger · Character Atelier

*A private, dark-academia workbench for building JanitorAI / SillyTavern character cards, powered by your own Claude API key.*

</div>

---

The Ledger is a single, dependency-free web page. Open it, add your Anthropic
API key, and draft detailed character profiles that follow your exact template
and continuity canon — then export them as SillyTavern **v2 PNG cards** or
**JSON**, and keep them in a local **Library**. Nothing is uploaded anywhere:
your key and your characters live in your browser.

## Features

- **Draft with Claude** — one brief becomes a full profile that strictly follows
  the JanitorAI template and rules (no em dashes, no markdown inside the block,
  `{user}` kept a blank slate, character tag renamed automatically).
- **Token gauge** — live estimate against the ~1,800 target and 2,150 soft
  ceiling, so you catch an over-length card before you spend a request.
- **Project Memory** — your Trinity / Yale continuity canon is sent to Claude as
  a *cached* context block, so recurring NPCs carry into every build. Fully
  editable in Settings.
- **Romantic Enchantment style** — the imported `romantic-enchantment-style`
  skill is injected into narrative-heavy sections at the flip of a toggle.
- **Refine** — send only the current draft plus a one-line instruction (cheap,
  stateless revisions instead of a growing chat).
- **SillyTavern import / export**
  - PNG character cards (spec v2, `chara` tEXt chunk) — drag-drop or file.
  - JSON cards (v2, with a legacy v1 mirror for maximum compatibility).
- **Library** — save, browse, reopen, and delete characters from a pop-up, all
  in local storage.
- **Two themes** — a dark "reading room" (default) and a "day parchment" mode.

## Quick start

1. **Open the app.** Either double-click `index.html` (it runs from `file://`)
   or serve the folder (see *Deploy* below).
2. **Add your key.** Settings → paste your Anthropic API key. Get one at
   [console.anthropic.com](https://console.anthropic.com). It is stored only in
   this browser and sent directly to `api.anthropic.com`.
3. **Write a brief**, pick a model, and press **Draft with Claude**.
4. **Edit** the profile (your edits are canonical), then **Copy block**,
   **Export JSON/PNG**, or **Save entry**.

> The API call uses Anthropic's `anthropic-dangerous-direct-browser-access`
> header so the browser can talk to the API without a backend. This is the
> intended, supported way to run a personal browser tool with your own key.

## Efficiency by design

The whole point is to spend fewer tokens than working in a chat window:

- **Prompt caching** on the static prefix (rules + template + Project Memory).
  After the first call, that large context is re-read from cache at a fraction
  of the cost. Toggle in Settings.
- **Stateless generation** — each draft is a single self-contained request. No
  conversation history accumulates, so context stays small every time.
- **Model tiers** — Haiku 4.5 for fast/cheap drafts, Sonnet 5 for balance,
  Opus 4.8 / Fable 5 for the richest prose.
- **Usage readout** after every call (input, cached, output tokens).

## Deploy to GitHub Pages

Settings → Pages → Deploy from branch → pick your branch and `/ (root)`.
Your app is served at `https://<user>.github.io/The-Ledger/`. The API key still
lives only in the visitor's browser.

## Project structure

```
index.html                     The entire app (HTML + CSS + JS, no build step)
docs/character-template.txt     The JanitorAI template and rules (reference)
docs/project-memory.md          Default continuity canon (seeded into the app)
skills/romantic-enchantment-style/SKILL.md   The imported writing-style skill
test/smoke.mjs                  Headless Chromium smoke test
CLAUDE.md                       Notes for Claude Code sessions in this repo
```

## Privacy & security

- Your API key and characters never leave your browser (local storage only).
- No analytics, no bundler, no third-party requests except the Anthropic API
  call you trigger.
- Treat exported cards as you would any character file: they embed the full
  profile text.

## Development

No install needed to use it. To run the smoke test (needs Node + Playwright's
Chromium, both preinstalled in the web environment):

```bash
node test/smoke.mjs
```

## License

MIT — see [LICENSE](LICENSE).
