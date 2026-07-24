# CLAUDE.md

Context for Claude Code sessions in this repo. Kept short on purpose — a long
CLAUDE.md is loaded every session and wastes the context window it is meant to
protect.

## What this is

`The Ledger` — a single-file, dependency-free web app for building JanitorAI /
SillyTavern character cards with the user's own LLM API key. Providers live in
the `PROVIDERS` registry (Claude, ChatGPT, Gemini, DeepSeek, GLM, Grok, Kimi),
each with a `format` of `anthropic` | `openai` | `gemini`; `buildRequest` /
`parseResponse` branch on it. Everything is in `index.html` (HTML + CSS + JS
inline). There is **no build step and no package manager**. Do not add a
framework, a bundler, or npm dependencies unless asked.

## Where things live

- `index.html` — the whole app. JS is one IIFE with banner-commented sections:
  constants · state · token gauge · api · png · cards · import/export · library
  · ui · boot.
- `docs/character-template.txt` — the JanitorAI template + rules. If the template
  changes, update the `TEMPLATE` and `RULES` constants in `index.html` to match.
- `docs/project-memory.md` — default continuity canon, mirrored in the
  `MEMORY_DEFAULT` constant.
- `skills/romantic-enchantment-style/SKILL.md` — the imported style; its guidance
  is mirrored in the `STYLE_SKILL` constant.
- `test/smoke.mjs` — headless Chromium smoke test.

## Conventions

- Style tokens are CSS custom properties on `:root`; components read tokens, not
  raw hex. Two themes via `[data-theme="dark|light"]`.
- No em dashes in the app's *output* (a hard rule of the character format).
- Persist user data in `localStorage` under `ledger.*` keys; never send it
  anywhere except the Anthropic API call the user triggers.

## Efficiency (the user's priority)

- API calls are **stateless** (no chat history) and use **prompt caching** on the
  static rules+template+memory prefix. Keep it that way; do not accumulate
  conversation turns.
- Prefer editing `index.html` in place with small, targeted `Edit`s over
  rewriting the file. Don't re-read files you just wrote.

## Validate changes

Run `node test/smoke.mjs` (uses `/opt/pw-browsers/chromium`). It checks: page
load with zero console errors, token gauge, blank-template insert, JSON export +
re-import mapping, PNG v2 embed + read round-trip, Library save/render, and the
theme toggle.
