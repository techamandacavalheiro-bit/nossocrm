# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cavalheiro Experience** is an intelligent CRM platform with an integrated AI assistant designed for sales teams. It provides visual pipeline management, contact organization, and AI-powered tools for analysis, script generation, and opportunity management. Built on modern full-stack technology with emphasis on real-time collaboration and multi-tenant data isolation.

## Development Commands

```bash
# Development
npm run dev                 # Start dev server (localhost:3000)

# Code Quality
npm run lint               # ESLint with zero warnings enforced
npm run typecheck          # TypeScript strict mode check
npm test                   # Vitest watch mode
npm run test:run           # Vitest single run
npx vitest path/to/file    # Run specific test file

# Build & Pre-submit
npm run build              # Next.js production build
npm run precheck           # lint + typecheck + test:run + build (full validation)
npm run precheck:fast      # lint + typecheck + test:run (skip build)
npm run stories            # Run test/stories tests (dot reporter)

# Integration Testing
npm run smoke:integrations # Verify webhook integrations
```

## Architecture Overview

### Layered SSOT Pattern (Single Source of Truth)

```
TanStack Query (Server Cache) ← SSOT for server state
     ↓
React Context (Domain Logic) ← Orchestration facades (Contacts, Deals, etc.)
     ↓
Zustand (Local UI State) ← Ephemeral state only (modals, forms, notifications)
```

**Never mix state layers.** UI state goes to Zustand, derived calculations go to Context, server state lives in Query.

### Core Stack Decisions

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js 20+ | ES modules throughout |
| **Framework** | Next.js 16 App Router | Server Components + `proxy.ts` auth pattern |
| **Language** | TypeScript 5 strict | Strict mode mandatory |
| **Database** | Supabase (PostgreSQL + Realtime) | Multi-tenant RLS + webhooks + Edge Functions |
| **Queries** | TanStack Query v5 | Server cache with single source of truth |
| **Forms** | React Hook Form + Zod | Schema validation, type-safe |
| **UI** | Radix UI + Tailwind CSS v4 | Accessible headless + utility-first styling |
| **Testing** | Vitest + React Testing Library | Fast, native to Vite, with DOM environment |
| **AI** | Vercel AI SDK v6 | Streaming chat + structured tasks |

## Critical Architecture Rules

### 1. Multi-Tenant Data Isolation (NON-NEGOTIABLE)

**All queries MUST filter by `organization_id`.** This is a security boundary.

```typescript
// ✅ CORRECT: Filter by organization_id
const result = await supabase
  .from('deals')
  .select('*')
  .eq('organization_id', orgId)

// ❌ WRONG: Missing organization filter
const result = await supabase
  .from('deals')
  .select('*')

// Service role in AI tools MUST always include org filter
const result = await staticAdminClient
  .from('contacts')
  .select('*')
  .eq('organization_id', orgId)  // REQUIRED even with service role
```

**Pattern:** Store `organizationId` in context, derive from:
- User `profiles.organization_id` (read in `lib/supabase/middleware.ts`)
- Request headers in API routes
- Hooks in protected components (via context, never query directly)

### 2. Cache Rules (CRITICAL for Performance)

**Use single cache per entity.** All operations (fetch, create, update, realtime) hit the same cache key family.

#### Pattern for Deals (Special Case)

```typescript
// lib/query/queryKeys.ts
deals: {
  all: ['deals'],
  lists: () => ['deals', 'list'],
  list: (filters) => ['deals', 'list', filters],  // Separate cache per filter
  details: () => ['deals', 'detail'],
  detail: (id) => ['deals', 'detail', id],
  views: () => [...deals.lists(), 'view'],        // ← Use this for mutations
},

// For optimistic updates, use 'view' cache ONLY
queryClient.setQueryData(
  [...queryKeys.deals.lists(), 'view'],  // ← Always this key
  (old) => old ? [...old, newDeal] : [newDeal]
)
```

**For other entities** (contacts, companies, etc.):
```typescript
// Use queryKeys.{entity}.lists() for mutations
queryClient.setQueryData(
  queryKeys.contacts.lists(),
  (old) => old ? [...old, newContact] : [newContact]
)

// Never use queryKeys.{entity}.list(filters) for optimistic updates
// Those are separate caches and break when filters change
```

**Prefer `setQueryData` over `invalidateQueries`** for instant UI updates. Invalidation causes loading states.

### 3. Proxy-Based Authentication (NOT middleware.ts)

Auth flow uses **`proxy.ts`** (Next.js interceptor) + **`lib/supabase/middleware.ts`** (updates session).

```typescript
// proxy.ts runs FIRST
// - Checks authorization
// - Redirects unauthenticated users

// Skips: /api/* routes (Route Handlers must respond with 401/403)
// Protects: /app/*, /install, /login, etc.

// lib/supabase/middleware.ts runs when auth changes
// - Updates browser cookie with refreshed session
```

**DO NOT:**
- Add auth logic to `middleware.ts` (doesn't run for proxy)
- Use 307 redirects in API routes (breaks fetch middleware)
- Return 3xx from `/api/*` for auth (clients can't follow)

### 4. Supabase Client Boundaries

Three client types in `lib/supabase/`:

| Client | Use For | Features |
|--------|---------|----------|
| **client.ts** | Browser + SSR | Can return `null` if `.env` not configured; handles auth state |
| **server.ts** | Route Handlers / Server Actions | Service role available via `createStaticAdminClient()` |
| **Realtime** | Live subscriptions | Use in UI with debounce (UPDATE/DELETE only, not INSERT) |

```typescript
// ❌ Wrong: Using client in server context
import { client } from '@/lib/supabase/client'
export async function POST(req) {
  const { data } = await client.from('deals').select() // NO
}

// ✅ Right: Using server client
import { server } from '@/lib/supabase/server'
export async function POST(req) {
  const { data } = await server().from('deals').select()
}

// ✅ Right: Service role for AI tools
import { createStaticAdminClient } from '@/lib/supabase/server'
const admin = createStaticAdminClient()
const { data } = await admin.from('deals').select()
  .eq('organization_id', orgId)  // MUST filter
```

### 5. AI Pattern (Vercel SDK v6)

**Chat:** Streaming messages
```typescript
// POST /api/ai/chat
// 1. Validates same-origin (lib/security/sameOrigin.ts)
// 2. Resolves organizationId from user.profiles
// 3. Creates agent (lib/ai/crmAgent.ts)
// 4. Tools use service role with organization filter
```

**Configuration:** Organization-wide settings in `organization_settings`:
- AI provider (Gemini, OpenAI, Claude)
- Model, temperature, max_tokens
- **This is the source of truth** (no user-level fallback)

**Tools** (`lib/ai/tools.ts`):
- Always query with `organizationId` filter
- Example: "Show deals for {contact}" → filters by org
- Service role + explicit org filter = safe access

### 6. Form Validation (Zod + React Hook Form)

```typescript
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

const contactSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(255),
  phone: z.string().optional(),
})

export function ContactForm() {
  const form = useForm({
    resolver: zodResolver(contactSchema),
    defaultValues: { email: '', name: '' },
  })

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* form.register, form.formState.errors, etc. */}
    </form>
  )
}
```

**Zod v4 syntax:** This project uses Zod 4.x. See `.specswarm/tech-stack.md` for differences.

## Code Organization

```
app/
├── (app)/              # Layout group (header, nav)
├── (protected)/        # Auth-required routes
│   ├── (dashboard)/    # Sales pipeline, contacts, etc.
│   ├── deals/
│   ├── contacts/
│   ├── activities/
│   └── settings/
├── (auth)/             # Login, signup, join
├── api/
│   ├── ai/             # POST /api/ai/chat, /api/ai/tasks/*
│   ├── contacts/       # CRUD endpoints
│   ├── deals/
│   └── webhooks/       # Incoming integrations
└── layout.tsx

components/
├── ui/                 # shadcn/ui (copied, not npm imported)
│   ├── Button.tsx
│   ├── Card.tsx
│   └── ...
└── layout/             # App shell (Header, Sidebar, etc.)

context/
├── DealContext.tsx     # Facade over TanStack Query
├── ContactContext.tsx
└── index.ts

features/
├── deals/              # Feature module
│   ├── components/
│   ├── hooks/
│   └── DealsPage.tsx
├── contacts/
├── activities/
└── settings/

lib/
├── ai/                 # AI agent, tools, task clients
├── query/              # TanStack Query config, hooks
├── realtime/           # Supabase Realtime subscriptions
├── supabase/           # Client boundary (client/server/admin)
├── security/           # sameOrigin, CORS validation
└── utils/              # Helper functions (cn, formatCurrency, etc.)

hooks/                  # Shared hooks (useDebounce, useLocalStorage, etc.)

types/                  # Shared TypeScript types
├── database.ts         # Row types from Supabase
├── api.ts              # API request/response types
└── domain.ts           # Business logic types

test/
├── setup.ts            # Vitest setup (.env loading, mocks)
├── setup.dom.ts        # DOM polyfills
└── stories/            # Story-based tests
```

### File Naming

- **Components**: PascalCase (`DealCard.tsx`, `ContactForm.tsx`)
- **Functions/Hooks**: camelCase (`useDealQuery.ts`, `formatCurrency.ts`)
- **Utilities**: camelCase (`cn.ts`, `constants.ts`)
- **Types**: PascalCase (`Deal.ts`, `Contact.ts`)
- **Tests**: `{source}.test.ts(x)` in same directory as source

### Imports

Always use `@/` alias (configured in `tsconfig.json`):

```typescript
import { Button } from '@/components/ui/Button'
import { useDealQuery } from '@/hooks/useDealQuery'
import { formatCurrency } from '@/lib/utils'
```

## Testing Strategy

### Test Setup

Tests run with **happy-dom** (lightweight DOM) by default. Config in `vitest.config.ts`:

```typescript
// test/setup.ts - Runs before all tests
// - Loads .env.local
// - Mocks 'server-only'
// - Mocks Supabase if needed

// test/setup.dom.ts - Runs for DOM tests
// - Adds jest-dom matchers
// - Polyfills window/navigator
```

### Test Types

| Test | Pattern | When |
|------|---------|------|
| **Unit** | Test functions in isolation | Utilities, formatters, validators |
| **Component** | Use React Testing Library | UI components with user interactions |
| **Integration** | Query hooks + components | Form submission, data flow |
| **Accessibility** | `vitest-axe` | All interactive components |

### Example Test

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactForm } from './ContactForm'

describe('ContactForm', () => {
  it('submits form data when valid', async () => {
    const onSubmit = vi.fn()
    render(<ContactForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Name'), 'John Doe')
    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com')
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'John Doe', email: 'john@example.com' })
    )
  })
})
```

### Running Tests

```bash
npm run test                         # Watch mode
npm run test:run                     # Single run (CI)
npx vitest test/features/deals       # Specific directory
npm run stories                      # Story-based tests
npm run precheck                     # Lint + typecheck + test + build
```

## Environment Setup

### Development `.env.local`

Start with `.env.example`:

```bash
cp .env.example .env.local
```

**Required keys:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Public key (fallback: ANON_KEY)
- `SUPABASE_SECRET_KEY` — Service role key (fallback: SERVICE_ROLE_KEY)

**Optional (for AI):**
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini API
- `OPENAI_API_KEY` — GPT models
- `ANTHROPIC_API_KEY` — Claude models

**For testing:**
- `ALLOW_AI_TEST_ROUTE=true` — Enables `/api/ai/test` (dev-only)

## Key Patterns & Anti-Patterns

### ✅ DO

- **Filter by org:** All Supabase queries include `.eq('organization_id', orgId)`
- **Validate at boundaries:** Form inputs, API requests, webhook payloads
- **Type-safe forms:** Use Zod schemas with React Hook Form
- **Optimize queries:** Use `staleTime`, `gcTime` appropriately
- **Test behavior:** Focus on user interactions, not implementation details
- **Single cache per entity:** Don't scatter queries across multiple cache keys
- **Server Components:** Use RSC by default, Client Components only when needed
- **Accessibility:** Include `aria-label`, `role` attributes on interactive elements

### ❌ DON'T

- **Expose secrets:** Never put API keys in components or client code
- **Multi-tenant breaches:** Always filter by `organization_id` (even service role)
- **Mixing state:** Don't use TanStack Query for UI state (use Zustand)
- **Premature optimization:** First make it work, then profile (Realtime debounce is exception)
- **Generic fetch:** Use TanStack Query hooks for server state
- **Hardcoded values:** Move to `lib/constants.ts` or Supabase settings
- **Format inconsistency:** Use Tailwind utilities, not inline styles
- **Stale comments:** Delete/update comments when code changes
- **Unnecessary abstraction:** Three similar functions is better than one premature generic

## Debugging & Troubleshooting

### Common Issues

**Issue: "Supabase not configured" message in console**
- `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` missing
- Dev server requires `.env.local` reload

**Issue: Tests fail with "Cannot find module 'server-only'"**
- `test/setup.ts` should mock `server-only`
- Check vitest config includes setup file

**Issue: 401 Unauthorized in API route**
- Route Handler didn't resolve `userId`/`orgId` from session
- Check proxy isn't intercepting `/api/*` (it shouldn't)
- Verify session middleware runs first

**Issue: Realtime not updating UI**
- Channel name mismatch in subscription
- Missing `realtimeUpdate` handler in component
- Check payload matches expected shape

**Issue: Form validation error but schema looks correct**
- Zod v4 syntax differs from v3 (see `.specswarm/tech-stack.md`)
- Schema mismatch with form default values

### Debug Helpers

```bash
# Check environment
echo $NEXT_PUBLIC_SUPABASE_URL

# Test single file
npx vitest path/to/test.ts

# Inspect types
npm run typecheck -- --diagnostics

# Rebuild bundle (if styles broken)
npm run build
```

## Performance Notes

### Realtime Subscriptions

Realtime updates are enabled for frequently-changing tables (deals, activities, messages). Apply debounce to batch writes:

```typescript
// ✅ CORRECT: Debounce for UPDATE/DELETE
supabase
  .channel('deals-changes')
  .on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'deals' },
    debounce(handler, 500)  // Batch updates
  )
  .subscribe()

// ⚠️  Note: INSERT doesn't need debounce (new rows, no duplication)
```

### Query Caching Strategy

```typescript
// lib/query/queryKeys.ts configures staleTime/gcTime
// Adjust based on update frequency:

deals: {
  staleTime: 1000 * 60,      // 1 minute before re-fetch
  gcTime: 1000 * 60 * 5,     // Keep 5 min after unused
}

contacts: {
  staleTime: 1000 * 60 * 10, // 10 minutes (less frequent changes)
  gcTime: 1000 * 60 * 30,    // Keep 30 min
}
```

## References

- **Architecture Decision:** See `AGENTS.md` for code style and cache rules
- **Tech Stack Details:** `.specswarm/tech-stack.md`
- **Public API:** `docs/public-api.md` (webhooks, external integrations)
- **Webhooks:** `docs/webhooks.md`
- **MCP Integration:** `docs/mcp.md`

## Getting Help

- **Type errors?** Run `npm run typecheck` for detailed messages
- **Lint errors?** ESLint is strict (zero warnings). Run `npm run lint -- --fix` for auto-fixes
- **Test failures?** Use `npm test -- --reporter=verbose path/to/test`
- **Performance questions?** Check TanStack Query docs + Supabase RLS impact
