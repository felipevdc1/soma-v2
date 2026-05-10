# Hydra Project — Claude Context

## Stack
- Next.js 14 + Supabase
- TypeScript strict mode
- Tailwind CSS
- pnpm workspaces

## Project Structure
- `apps/web` — main web application
- `apps/api` — API service layer
- `packages/ui` — shared component library
- `packages/config` — shared configuration

## Conventions
- Squad copywriter-os in ~/squads/
- All rendering done client-side for creative previews
- Server components for data fetching only
- Conventional commits (feat/fix/chore/docs)

## Key Services
- Supabase Auth for authentication
- Supabase Storage for asset management
- OpenAI API for creative generation
- Anthropic Claude for copy generation

## Development Workflow
- `pnpm dev` — start all services locally
- `pnpm test` — run full test suite
- `pnpm build` — production build

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `OPENAI_API_KEY` — OpenAI API key
- `ANTHROPIC_API_KEY` — Claude API key (see feedback_api_key_explicit_permission.md)

## Squads & Integrations
- copywriter-os: handles all copy generation tasks
- vidin-os: handles video creative generation
- Single-tenant by design (Aryse first)

## Memory
- Project memory in memory/hydra.md
- Cross-session context via mempalace
