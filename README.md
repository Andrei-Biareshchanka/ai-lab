# AI Lab

Personal learning lab for exploring AI/Claude API topics.

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

## Topics

| # | Topic | Status |
|---|-------|--------|
| [01-agents](./01-agents/) | Tool use & agentic loops | ✅ Done |
| [02-mcp](./02-mcp/) | Model Context Protocol | 🔨 Next |
| [03-streaming](./03-streaming/) | Streaming responses | 📋 Planned |

## Running examples

```bash
npm run 01:parable
```

## Security

- Never commit `.env` — it's in `.gitignore`
- Use `.env.example` as a template (safe to commit, no real keys)
- Real keys live only in `.env` locally
