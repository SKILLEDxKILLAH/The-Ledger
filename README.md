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

- **Draft with your model of choice** — one brief becomes a full profile that
  strictly follows the JanitorAI template and rules (no em dashes, no markdown
  inside the block, `{user}` kept a blank slate, character tag renamed
  automatically). Pick from seven providers (see below), each with its own key.
- **Token gauge** — live estimate against the ~1,800 target and 2,150 soft
  ceiling, so you catch an over-length card before you spend a request.
- **Project Memory** — your Trinity / Yale continuity canon is sent to the model
  as a context block (cached on Claude), so recurring NPCs carry into every
  build. Fully editable in Settings.
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
2. **Pick a provider and add its key.** Settings → choose a provider → paste the
   key. Each provider stores its own key, only in this browser; the key is sent
   directly to that provider and nowhere else.
3. **Write a brief**, choose a model, and press **Draft**.
4. **Edit** the profile (your edits are canonical), then **Copy block**,
   **Export JSON/PNG**, or **Save entry**.

## Providers

Choose any of these in Settings; the model box suggests common ids per provider
and accepts any current model id you type.

| Provider | Get a key | Browser calls |
| --- | --- | --- |
| **Claude** (Anthropic) | console.anthropic.com | direct ✓ |
| **ChatGPT** (OpenAI) | platform.openai.com/api-keys | direct ✓ |
| **Gemini** (Google) | aistudio.google.com/apikey | direct ✓ |
| **DeepSeek** | platform.deepseek.com | may need a proxy |
| **GLM** (Zhipu / Z.ai) | z.ai · open.bigmodel.cn | may need a proxy |
| **Grok** (xAI) | console.x.ai | may need a proxy |
| **Kimi** (Moonshot) | platform.moonshot.ai | may need a proxy |

Claude, ChatGPT, and Gemini return the CORS headers a browser needs, so they
work with no backend (Claude via the `anthropic-dangerous-direct-browser-access`
header). The others may block direct browser calls; if a request cannot reach
the provider, set a **custom endpoint** (Settings → Advanced) pointing at your
own HTTPS/CORS proxy. Nothing is proxied through any server you do not choose.

## Efficiency by design

The whole point is to spend fewer tokens than working in a chat window:

- **Prompt caching** on the static prefix (rules + template + Project Memory).
  On Claude this uses explicit `cache_control`; the OpenAI-compatible providers
  cache the identical prefix automatically. Either way the big context is re-read
  cheaply after the first call. Toggle in Settings.
- **Stateless generation** — each draft is a single self-contained request. No
  conversation history accumulates, so context stays small every time.
- **Model tiers** — every provider exposes cheap-and-fast through top-tier
  models; start cheap for drafts and escalate only when the prose needs it.
- **Usage readout** after every call (input, cached, output tokens), normalized
  across providers.

## Deploy to GitHub Pages

A workflow is included at `.github/workflows/pages.yml` that deploys on every
push to `main` (and on demand from the Actions tab → Run workflow).

**One-time setup (required):** Settings → Pages → Build and deployment →
**Source: GitHub Actions**. GitHub does not let the workflow token create the
Pages site on its own, so this single toggle has to be done by a repo admin
once; after that, deploys are automatic.

Your app is served at `https://<user>.github.io/The-Ledger/`. The API key still
lives only in the visitor's browser.

(Prefer no Actions? Settings → Pages → Deploy from branch → pick a branch and
`/ (root)` works too, since the whole app is a static `index.html`.)

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
