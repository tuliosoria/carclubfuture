# Agent Skills

Vendored skill packs for AI coding agents working in this repo.

## Sources

- **`vercel-labs-agent-skills/skills/`** — from
  [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)
  Includes: `composition-patterns`, `deploy-to-vercel`,
  `react-best-practices`, `react-native-skills`, `react-view-transitions`,
  `vercel-cli-with-tokens`, `web-design-guidelines`.

- **`obra-superpowers/skills/`** — from
  [obra/superpowers](https://github.com/obra/superpowers)
  Includes process skills like `brainstorming`, `executing-plans`,
  `systematic-debugging`, `test-driven-development`,
  `verification-before-completion`, `writing-plans`, `writing-skills`,
  and more.

## Usage

Each skill is a self-contained directory. Most contain a `SKILL.md`
(short pitch + when-to-use), an `AGENTS.md` (the bulk of guidance), and
sometimes `rules/`, `examples/`, or other supporting files. Agents that
support skills (Claude Code, Codex, Cursor, Gemini, OpenCode, this CLI)
can be pointed at these directories directly, or you can copy individual
skills into a tool-specific config dir.

## Refreshing

Both packs were vendored via sparse `git clone` of the upstream repos'
`skills/` directories. To update, re-run the equivalent of:

```sh
rm -rf .agent-skills/vercel-labs-agent-skills .agent-skills/obra-superpowers
cd .agent-skills
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/vercel-labs/agent-skills.git vercel-labs-agent-skills
( cd vercel-labs-agent-skills && git sparse-checkout set skills && rm -rf .git )
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/obra/superpowers.git obra-superpowers
( cd obra-superpowers && git sparse-checkout set skills && rm -rf .git )
```

## Licensing

Each upstream repo carries its own license — see their `LICENSE` files
on GitHub. Vendored skills retain their original licensing; this
directory is a redistribution for in-repo agent convenience only.
