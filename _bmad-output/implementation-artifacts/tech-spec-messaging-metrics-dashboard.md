---
title: 'Dashboard de Métricas de Messaging'
slug: 'messaging-metrics-dashboard'
created: '2026-02-08'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Next.js 16 App Router', 'Supabase Postgres + RLS', 'TanStack Query v5', 'Tailwind 4', 'Radix UI', 'Lucide Icons', 'Zod 4']
files_to_modify:
  - 'supabase/migrations/20260208100000_messaging_metrics_columns.sql'
  - 'app/api/messaging/messages/route.ts'
  - 'app/api/messaging/messages/send-template/route.ts'
  - 'lib/ai/agent/agent.service.ts'
  - 'lib/voice/webhook-handler.ts'
  - 'lib/query/queryKeys.ts'
  - 'lib/query/hooks/useMessagingMetricsQuery.ts'
  - 'lib/query/hooks/useOrgMembersQuery.ts'
  - 'lib/query/hooks/index.ts'
  - 'lib/utils/periodToDateRange.ts'
  - 'features/dashboard/components/MessagingMetricsSection.tsx'
  - 'features/dashboard/DashboardPage.tsx'
code_patterns:
  - 'Query Keys Factory (createExtendedQueryKeys)'
  - 'useQuery + Supabase RPC in queryFn'
  - 'useAuth() for organization_id'
  - 'AIMetricCard pattern for dashboard cards'
  - 'PeriodFilter type from useDashboardMetrics'
  - 'Barrel exports in lib/query/hooks/index.ts'
  - 'Glass card pattern with Tailwind'
  - 'Supabase RPC for server-side aggregation'
test_patterns:
  - 'E2E story tests in test/stories/'
  - 'vi.mock for Supabase client'
  - 'Pattern: US-XXX-feature-name.test.tsx'
---

# Tech-Spec: Dashboard de Métricas de Messaging

**Created:** 2026-02-08

## Overview

### Problem Statement

O time comercial não tem visibilidade sobre volume de mensagens, produtividade por vendedor, e tempos de resposta. Sem essas métricas, gestores não conseguem avaliar performance individual, identificar gargalos de atendimento, ou garantir SLAs.

### Solution

Migration adicionando `sender_user_id` e `sender_type` em TODOS os paths de mensagens outbound, campos denormalizados de First Response Time na conversa, RPC function pra agregação server-side de métricas, hook no client, e seção de dashboard com filtro por vendedor.

### Scope

**In Scope:**
- Migration: `sender_user_id UUID` + `sender_type TEXT` em `messaging_messages`
- Migration: `first_response_at TIMESTAMPTZ` + `first_response_seconds INTEGER` em `messaging_conversations`
- Trigger SQL pra calcular FRT com guard contra race conditions
- RPC function `get_messaging_metrics()` pra agregação server-side
- Ajuste em TODOS os 5 paths de outbound: mensagem direta, template, AI agent, secure-tools (CHECK fix), voice webhook
- Hook `useMessagingMetricsQuery()` chamando a RPC
- Hook `useOrgMembersQuery()` separado pra dropdown de vendedores
- Utility `periodToDateRange()` pra converter PeriodFilter em date range
- Componente `MessagingMetricsSection` na `DashboardPage.tsx`
- Cards: Mensagens Enviadas, Novos Contatos, First Response Time, Taxa de Resposta

**Out of Scope:**
- Página `/analytics` separada
- Comparação entre períodos
- Export de relatórios
- Métricas por canal
- Backfill retroativo de mensagens antigas sem `sender_user_id`
- Alinhar `AIMetricsSection` ao period selector (inconsistência conhecida, future improvement)

## Context for Development

### Codebase Patterns

- **Query Keys Factory**: `lib/query/queryKeys.ts` — usa `createExtendedQueryKeys()` para entities com sub-keys
- **AI Metrics pattern**: `queryKeys.ai.metrics(orgId)` — objeto manual (não factory) dentro de `ai: {}`
- **`useAIMetricsQuery()`** em `lib/query/hooks/useAIMetricsQuery.ts` — padrão a seguir:
  - `useAuth()` de `@/context/AuthContext` pra obter `profile.organization_id`
  - `supabase` importado de `@/lib/supabase`
  - `staleTime: 60_000`, `gcTime: 300_000`
- **`AIMetricsSection`** em `features/dashboard/components/AIMetricsSection.tsx`:
  - `AIMetricCard` interno com props: icon, label, value, subtext, color, onClick
  - Grid `md:grid-cols-4`, loading skeleton, empty state
  - Glass card: `glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm`
  - Nota: `AIMetricsSection` NÃO recebe `period` prop (sempre usa "this month"). A nova seção vai receber `period` — inconsistência reconhecida, não corrigida nesta spec.
- **DashboardPage** em `features/dashboard/DashboardPage.tsx`:
  - State `period: PeriodFilter` (tipo em `features/dashboard/hooks/useDashboardMetrics.ts`)
  - Seções: Header → KPIs → Saúde da Carteira → **[NOVA SEÇÃO AQUI]** → AI Metrics → Funnel + Activities
- **Barrel exports**: `lib/query/hooks/index.ts`
- **Defense-in-depth**: Todas queries filtram por `organization_id`

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `supabase/migrations/20260205100000_create_messaging_system.sql` | Schema original: `messaging_messages`, `messaging_conversations` |
| `app/api/messaging/messages/route.ts` | Envio direto — `user` disponível via `supabase.auth.getUser()`, insert sem user_id |
| `app/api/messaging/messages/send-template/route.ts` | Envio template — também tem auth, insert sem user_id |
| `lib/ai/agent/agent.service.ts` | AI response insert — `metadata: { sent_by_ai: true }`, sem sender_type |
| `lib/ai/agent/secure-tools.ts` | HITL insert — já usa `sender_type: 'agent'` |
| `lib/voice/webhook-handler.ts` | Voice transcript — insert sem sender_type/content_type |
| `lib/query/queryKeys.ts` | Query keys — `ai: {}` pattern, messaging keys |
| `lib/query/hooks/useAIMetricsQuery.ts` | Hook referência |
| `features/dashboard/components/AIMetricsSection.tsx` | Componente referência |
| `features/dashboard/DashboardPage.tsx` | Page — period state, seção AI Metrics |
| `features/dashboard/hooks/useDashboardMetrics.ts` | `PeriodFilter` type, `PERIOD_LABELS` |
| `supabase/migrations/20251201000000_schema_init.sql` | `profiles` table — `name`, `first_name`, `last_name` |

### Technical Decisions

- **`sender_user_id` UUID nullable REFERENCES profiles(id) ON DELETE SET NULL**: Nullable — inbound e AI msgs não têm user humano.
- **`sender_type` TEXT com CHECK**: Valores expandidos: `('user', 'ai', 'agent', 'system')`. Inclui `'agent'` (já usado em `secure-tools.ts`) e `'system'` pra voice transcripts.
- **RPC function `get_messaging_metrics()`**: Resolve 4 problemas simultaneamente:
  1. `messaging_messages` não tem `organization_id` → RPC faz JOIN server-side
  2. RLS pode filtrar mensagens pra managers → RPC usa `SECURITY DEFINER` com check de org membership
  3. PostgREST não suporta JOIN condicional → RPC faz SQL nativo
  4. `PeriodFilter = 'all'` seria full table scan → RPC limita a 365 dias máximo
- **FRT trigger com guard**: UPDATE inclui `WHERE first_response_at IS NULL` pra evitar race condition em inserts concorrentes. Trigger exclui `sender_type = 'system'` pra não atribuir FRT a voice transcripts.
- **"Novo contato" simplificado**: Contact cujo `created_at` cai dentro do período selecionado = novo. Contact cujo `created_at` é anterior ao período = follow-up. Sem heurística de 1h. Conversas sem `contact_id` são excluídas do count.
- **Card 4 = "Taxa de Resposta"** (não "Tempo Médio"): % de conversas com inbound que receberam pelo menos 1 outbound no período. Métrica distinta do FRT e útil como SLA.
- **Profiles query separada**: `useOrgMembersQuery()` com `staleTime: 5min` — não roda junto com metrics a cada 60s.
- **Query key `messagingMetrics`**: Top-level como `messagingChannels`, `messagingConversations`. Invalidação em massa do messaging module não é suportada (debt existente — todos os messaging keys são top-level independentes).
- **Enforcement de `sender_user_id`**: API routes são o ponto de controle (não RLS). O campo não é passado pelo client — a API seta `user.id` server-side.

## Implementation Plan

### Tasks

- [ ] **Task 1: Migration — colunas + trigger + RPC**
  - File: `supabase/migrations/20260208100000_messaging_metrics_columns.sql`
  - Action:
    1. **Colunas em `messaging_messages`**:
       ```sql
       ALTER TABLE messaging_messages
         ADD COLUMN sender_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
         ADD COLUMN sender_type TEXT CHECK (sender_type IN ('user', 'ai', 'agent', 'system'));
       ```
    2. **Índice composto para query de métricas** (substitui os 2 parciais):
       ```sql
       CREATE INDEX idx_msgs_metrics
         ON messaging_messages (conversation_id, direction, created_at, sender_user_id, sender_type)
         WHERE direction = 'outbound';
       ```
    3. **Colunas em `messaging_conversations`**:
       ```sql
       ALTER TABLE messaging_conversations
         ADD COLUMN first_response_at TIMESTAMPTZ,
         ADD COLUMN first_response_seconds INTEGER;
       ```
    4. **Trigger function com race condition guard**:
       ```sql
       CREATE OR REPLACE FUNCTION calculate_first_response_time()
       RETURNS TRIGGER AS $$
       DECLARE
         v_first_inbound_at TIMESTAMPTZ;
       BEGIN
         -- Só processar outbound de user/ai/agent (não system/voice)
         IF NEW.direction != 'outbound' OR NEW.sender_type = 'system' THEN
           RETURN NEW;
         END IF;

         -- Buscar primeira msg inbound da conversa
         SELECT MIN(created_at) INTO v_first_inbound_at
         FROM messaging_messages
         WHERE conversation_id = NEW.conversation_id
           AND direction = 'inbound';

         -- Se não tem inbound, não é uma "resposta"
         IF v_first_inbound_at IS NULL THEN
           RETURN NEW;
         END IF;

         -- Atomic update com guard: só atualiza se ainda não tem FRT
         UPDATE messaging_conversations
         SET
           first_response_at = NEW.created_at,
           first_response_seconds = EXTRACT(EPOCH FROM (NEW.created_at - v_first_inbound_at))::INTEGER
         WHERE id = NEW.conversation_id
           AND first_response_at IS NULL;

         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql;

       CREATE TRIGGER trg_calculate_frt
         AFTER INSERT ON messaging_messages
         FOR EACH ROW
         EXECUTE FUNCTION calculate_first_response_time();
       ```
    5. **RPC function pra métricas**:
       ```sql
       CREATE OR REPLACE FUNCTION get_messaging_metrics(
         p_org_id UUID,
         p_start_date TIMESTAMPTZ,
         p_end_date TIMESTAMPTZ DEFAULT NOW(),
         p_user_id UUID DEFAULT NULL
       )
       RETURNS JSONB
       LANGUAGE plpgsql
       SECURITY DEFINER
       SET search_path = public
       AS $$
       DECLARE
         v_result JSONB;
         v_messages_total INTEGER;
         v_messages_by_user JSONB;
         v_responses_by_type JSONB;
         v_new_contacts INTEGER;
         v_follow_ups INTEGER;
         v_avg_frt INTEGER;
         v_conversations_with_frt INTEGER;
         v_conversations_total INTEGER;
         v_conversations_with_response INTEGER;
         v_response_rate NUMERIC;
       BEGIN
         -- Verificar org membership do caller
         IF NOT EXISTS (
           SELECT 1 FROM profiles
           WHERE id = auth.uid()
             AND organization_id = p_org_id
         ) THEN
           RAISE EXCEPTION 'Unauthorized';
         END IF;

         -- Cap p_start_date: máximo 365 dias atrás
         IF p_start_date < NOW() - INTERVAL '365 days' THEN
           p_start_date := NOW() - INTERVAL '365 days';
         END IF;

         -- Mensagens outbound por tipo
         SELECT
           COUNT(*),
           COALESCE(jsonb_object_agg(
             COALESCE(sender_type, 'unknown'),
             type_count
           ), '{}'::jsonb)
         INTO v_messages_total, v_responses_by_type
         FROM (
           SELECT
             m.sender_type,
             COUNT(*) as type_count
           FROM messaging_messages m
           JOIN messaging_conversations c ON m.conversation_id = c.id
           WHERE c.organization_id = p_org_id
             AND m.direction = 'outbound'
             AND m.created_at >= p_start_date
             AND m.created_at <= p_end_date
             AND (p_user_id IS NULL OR m.sender_user_id = p_user_id)
           GROUP BY m.sender_type
         ) sub;

         -- Mensagens por vendedor (top 50)
         SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb)
         INTO v_messages_by_user
         FROM (
           SELECT
             m.sender_user_id as user_id,
             COALESCE(p.name, 'Não atribuído') as name,
             COUNT(*) as count
           FROM messaging_messages m
           JOIN messaging_conversations c ON m.conversation_id = c.id
           LEFT JOIN profiles p ON m.sender_user_id = p.id
           WHERE c.organization_id = p_org_id
             AND m.direction = 'outbound'
             AND m.created_at >= p_start_date
             AND m.created_at <= p_end_date
             AND (p_user_id IS NULL OR m.sender_user_id = p_user_id)
           GROUP BY m.sender_user_id, p.name
           ORDER BY count DESC
           LIMIT 50
         ) sub;

         -- Novos contatos vs Follow-ups
         SELECT
           COUNT(*) FILTER (WHERE cnt.created_at >= p_start_date AND cnt.created_at <= p_end_date),
           COUNT(*) FILTER (WHERE cnt.created_at < p_start_date)
         INTO v_new_contacts, v_follow_ups
         FROM messaging_conversations conv
         JOIN contacts cnt ON conv.contact_id = cnt.id
         WHERE conv.organization_id = p_org_id
           AND conv.created_at >= p_start_date
           AND conv.created_at <= p_end_date;

         -- SLA: First Response Time
         SELECT
           COALESCE(AVG(first_response_seconds)::INTEGER, 0),
           COUNT(*)
         INTO v_avg_frt, v_conversations_with_frt
         FROM messaging_conversations
         WHERE organization_id = p_org_id
           AND first_response_at >= p_start_date
           AND first_response_at <= p_end_date
           AND first_response_seconds IS NOT NULL;

         -- Taxa de Resposta: % de conversas com inbound que tiveram outbound
         SELECT
           COUNT(*),
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM messaging_messages m2
             WHERE m2.conversation_id = conv.id
               AND m2.direction = 'outbound'
               AND m2.created_at >= p_start_date
           ))
         INTO v_conversations_total, v_conversations_with_response
         FROM messaging_conversations conv
         WHERE conv.organization_id = p_org_id
           AND conv.created_at >= p_start_date
           AND conv.created_at <= p_end_date
           AND EXISTS (
             SELECT 1 FROM messaging_messages m
             WHERE m.conversation_id = conv.id
               AND m.direction = 'inbound'
           );

         v_response_rate := CASE
           WHEN v_conversations_total > 0
           THEN ROUND((v_conversations_with_response::NUMERIC / v_conversations_total) * 100, 1)
           ELSE 0
         END;

         -- Montar resultado
         v_result := jsonb_build_object(
           'messagesSent', jsonb_build_object(
             'total', v_messages_total,
             'byUser', v_messages_by_user,
             'byType', v_responses_by_type
           ),
           'contacts', jsonb_build_object(
             'new', v_new_contacts,
             'followUp', v_follow_ups
           ),
           'sla', jsonb_build_object(
             'avgFirstResponseSeconds', v_avg_frt,
             'conversationsWithFRT', v_conversations_with_frt
           ),
           'responseRate', jsonb_build_object(
             'rate', v_response_rate,
             'responded', v_conversations_with_response,
             'total', v_conversations_total
           )
         );

         RETURN v_result;
       END;
       $$;
       ```
  - Notes: `SECURITY DEFINER` garante que a RPC roda com permissões do owner (service role equivalente), mas valida org membership do caller via `auth.uid()`. O cap de 365 dias protege contra full table scans.

- [ ] **Task 2: Ajustar endpoint de envio direto**
  - File: `app/api/messaging/messages/route.ts`
  - Action: No objeto `messageData`, adicionar:
    ```typescript
    sender_user_id: user.id,
    sender_type: 'user' as const,
    ```
  - Notes: `user` já disponível via `supabase.auth.getUser()`. 2 linhas.

- [ ] **Task 3: Ajustar endpoint de envio de template**
  - File: `app/api/messaging/messages/send-template/route.ts`
  - Action: No objeto de insert, adicionar:
    ```typescript
    sender_user_id: user.id,
    sender_type: 'user' as const,
    ```
  - Notes: Verificar que o endpoint já tem `supabase.auth.getUser()`. Se não, adicionar auth check.

- [ ] **Task 4: Ajustar AI Agent**
  - File: `lib/ai/agent/agent.service.ts`
  - Action: No insert de mensagem AI (function `sendAIResponse`), adicionar:
    ```typescript
    sender_type: 'ai',
    ```
  - Notes: `sender_user_id` fica `null`. `metadata.sent_by_ai` continua por backward compat.

- [ ] **Task 5: Ajustar voice webhook handler**
  - File: `lib/voice/webhook-handler.ts`
  - Action: No insert do transcript, adicionar:
    ```typescript
    sender_type: 'system',
    content_type: 'audio',
    status: 'sent',
    ```
  - Notes: `'system'` garante que o trigger FRT ignora voice transcripts. Também corrige campos faltando (`content_type`, `status`).

- [ ] **Task 6: Verificar secure-tools.ts (já OK, apenas CHECK fix)**
  - File: `lib/ai/agent/secure-tools.ts`
  - Action: Nenhuma mudança no código — `sender_type: 'agent'` já está correto. O CHECK constraint na Task 1 já inclui `'agent'`.
  - Notes: Confirmar que o valor `'agent'` é preservado. Não alterar pra `'ai'`.

- [ ] **Task 7: Criar utility `periodToDateRange`**
  - File: `lib/utils/periodToDateRange.ts` (NOVO)
  - Action: Criar função que converte `PeriodFilter` em `{ start: string; end: string }`:
    ```typescript
    import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

    export function periodToDateRange(period: PeriodFilter): { start: string; end: string } {
      const now = new Date();
      const end = now.toISOString();

      switch (period) {
        case 'today': {
          const d = new Date(); d.setHours(0,0,0,0);
          return { start: d.toISOString(), end };
        }
        case 'yesterday': {
          const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0);
          const e = new Date(); e.setHours(0,0,0,0);
          return { start: d.toISOString(), end: e.toISOString() };
        }
        case 'last_7_days': {
          const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0);
          return { start: d.toISOString(), end };
        }
        case 'last_30_days': {
          const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0);
          return { start: d.toISOString(), end };
        }
        case 'this_month': {
          const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
          return { start: d.toISOString(), end };
        }
        case 'last_month': {
          const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); d.setHours(0,0,0,0);
          const e = new Date(); e.setDate(1); e.setHours(0,0,0,0);
          return { start: d.toISOString(), end: e.toISOString() };
        }
        case 'this_quarter': {
          const q = Math.floor(now.getMonth() / 3) * 3;
          const d = new Date(now.getFullYear(), q, 1);
          return { start: d.toISOString(), end };
        }
        case 'last_quarter': {
          const q = Math.floor(now.getMonth() / 3) * 3;
          const d = new Date(now.getFullYear(), q - 3, 1);
          const e = new Date(now.getFullYear(), q, 1);
          return { start: d.toISOString(), end: e.toISOString() };
        }
        case 'this_year': {
          const d = new Date(now.getFullYear(), 0, 1);
          return { start: d.toISOString(), end };
        }
        case 'all':
        default: {
          // Cap: 365 dias (RPC também limita server-side)
          const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setHours(0,0,0,0);
          return { start: d.toISOString(), end };
        }
      }
    }
    ```
  - Notes: `PeriodFilter = 'all'` é limitado a 365 dias no client E no server (double cap). Função pura, testável.

- [ ] **Task 8: Adicionar query keys**
  - File: `lib/query/queryKeys.ts`
  - Action: Adicionar no bloco `// MESSAGING MODULE`:
    ```typescript
    /**
     * Messaging metrics query keys.
     */
    messagingMetrics: {
      all: ['messagingMetrics'] as const,
      byPeriod: (orgId: string, period: string, userId?: string) =>
        ['messagingMetrics', orgId, period, userId] as const,
    },

    /**
     * Organization members query keys (for filters/dropdowns).
     */
    orgMembers: {
      all: ['orgMembers'] as const,
      list: (orgId: string) => ['orgMembers', orgId] as const,
    },
    ```
  - Notes: `messagingMetrics` como top-level, consistente com `messagingChannels`, `messagingConversations` etc. `orgMembers` separado pra reutilização.

- [ ] **Task 9: Criar hook `useOrgMembersQuery`**
  - File: `lib/query/hooks/useOrgMembersQuery.ts` (NOVO)
  - Action: Hook simples pra lista de membros da org:
    ```typescript
    export interface OrgMember { id: string; name: string; }

    export function useOrgMembersQuery() {
      const { profile } = useAuth();
      const orgId = profile?.organization_id;

      return useQuery({
        queryKey: queryKeys.orgMembers.list(orgId ?? ''),
        queryFn: async (): Promise<OrgMember[]> => {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('organization_id', orgId!)
            .order('name');
          if (error) throw error;
          return (data ?? []).map(p => ({ id: p.id, name: p.name ?? 'Sem nome' }));
        },
        enabled: !!orgId,
        staleTime: 5 * 60 * 1000, // 5 minutos (profiles mudam raramente)
        gcTime: 30 * 60 * 1000,   // 30 minutos
      });
    }
    ```
  - Notes: `staleTime` muito maior que metrics (5min vs 1min). Reutilizável por qualquer dropdown de "selecione membro".

- [ ] **Task 10: Criar hook `useMessagingMetricsQuery`**
  - File: `lib/query/hooks/useMessagingMetricsQuery.ts` (NOVO)
  - Action: Criar hook que chama a RPC:
    ```typescript
    import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
    import { periodToDateRange } from '@/lib/utils/periodToDateRange';

    export interface MessagingMetrics {
      messagesSent: {
        total: number;
        byUser: Array<{ user_id: string | null; name: string; count: number }>;
        byType: Record<string, number>; // { user: N, ai: N, agent: N, system: N }
      };
      contacts: {
        new: number;
        followUp: number;
      };
      sla: {
        avgFirstResponseSeconds: number;
        conversationsWithFRT: number;
      };
      responseRate: {
        rate: number; // 0-100
        responded: number;
        total: number;
      };
    }

    export function useMessagingMetricsQuery(period: PeriodFilter, userId?: string) {
      const { profile } = useAuth();
      const orgId = profile?.organization_id;

      return useQuery({
        queryKey: queryKeys.messagingMetrics.byPeriod(orgId ?? '', period, userId),
        queryFn: async (): Promise<MessagingMetrics> => {
          const { start, end } = periodToDateRange(period);
          const { data, error } = await supabase.rpc('get_messaging_metrics', {
            p_org_id: orgId!,
            p_start_date: start,
            p_end_date: end,
            p_user_id: userId ?? null,
          });
          if (error) throw error;
          return data as MessagingMetrics;
        },
        enabled: !!orgId,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
      });
    }
    ```
  - Notes: A RPC retorna JSONB que mapeia direto pra `MessagingMetrics`. O hook é thin — toda lógica de agregação está no SQL.

- [ ] **Task 11: Exportar hooks no barrel**
  - File: `lib/query/hooks/index.ts`
  - Action: Adicionar exports:
    ```typescript
    // Messaging Metrics
    export { useMessagingMetricsQuery } from './useMessagingMetricsQuery';
    export type { MessagingMetrics } from './useMessagingMetricsQuery';

    // Org Members
    export { useOrgMembersQuery } from './useOrgMembersQuery';
    export type { OrgMember } from './useOrgMembersQuery';
    ```
  - Notes: Inserir após exports de messaging existentes.

- [ ] **Task 12: Criar componente `MessagingMetricsSection`**
  - File: `features/dashboard/components/MessagingMetricsSection.tsx` (NOVO)
  - Action: Criar seguindo pattern de `AIMetricsSection.tsx`:
    1. **Props**: `{ period: PeriodFilter }`
    2. **State**: `selectedUserId: string` (default `'all'`)
    3. **Hooks**: `useMessagingMetricsQuery(period, userId)` + `useOrgMembersQuery()`
    4. **Layout**:
       - Header: `MessageSquare` icon + "Performance de Mensagens" + `<select>` vendedor (direita)
       - Grid `md:grid-cols-4`:
         - **Mensagens Enviadas**: icon `Send`, valor `messagesSent.total`, subtext "X por humanos, Y por IA"
         - **Novos Contatos**: icon `UserPlus`, valor `contacts.new`, subtext "X follow-ups"
         - **First Response Time**: icon `Clock`, valor formatado via `formatSeconds(sla.avgFirstResponseSeconds)`, subtext "X conversas medidas"
         - **Taxa de Resposta**: icon `CheckCircle`, valor `responseRate.rate%`, subtext "X de Y conversas respondidas"
       - Barra de distribuição: mensagens humanas vs AI (verde vs purple)
    5. **`formatSeconds` helper**:
       ```typescript
       function formatSeconds(seconds: number): string {
         if (seconds === 0) return '--';
         if (seconds < 60) return '< 1min';
         if (seconds < 3600) {
           const min = Math.floor(seconds / 60);
           const sec = seconds % 60;
           return sec > 0 ? `${min}min ${sec}s` : `${min}min`;
         }
         const hours = Math.floor(seconds / 3600);
         const min = Math.floor((seconds % 3600) / 60);
         return min > 0 ? `${hours}h ${min}min` : `${hours}h`;
       }
       ```
    6. **Loading**: Skeleton grid 4 cols com `animate-pulse`
    7. **Empty state**: "Nenhuma mensagem registrada neste período"
    8. **Dropdown vendedor**: `<select>` nativo com opções de `useOrgMembersQuery()`:
       ```html
       <select value={selectedUserId} onChange={...}>
         <option value="all">Todos os vendedores</option>
         {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
       </select>
       ```
  - Notes: Glass card, dark mode, Lucide icons. Dropdown nativo (Radix Select desnecessário aqui).

- [ ] **Task 13: Integrar no DashboardPage**
  - File: `features/dashboard/DashboardPage.tsx`
  - Action:
    1. Import: `import { MessagingMetricsSection } from './components/MessagingMetricsSection';`
    2. Inserir `<MessagingMetricsSection period={period} />` antes do `<AIMetricsSection />` (entre seção "Saúde da Carteira" e "AI Performance")
  - Notes: `period` state já existe no componente. 2 linhas de mudança.

### Acceptance Criteria

- [ ] **AC 1**: Given a user sends a message via `/api/messaging/messages`, when the message is saved, then `sender_user_id` equals the authenticated user's ID and `sender_type` equals `'user'`.
- [ ] **AC 2**: Given a user sends a template via `/api/messaging/messages/send-template`, when the message is saved, then `sender_user_id` equals the authenticated user's ID and `sender_type` equals `'user'`.
- [ ] **AC 3**: Given the AI agent sends a response via `agent.service.ts`, when the message is saved, then `sender_user_id` is NULL and `sender_type` equals `'ai'`.
- [ ] **AC 4**: Given a voice call creates a transcript via `webhook-handler.ts`, when the message is saved, then `sender_type` equals `'system'` and the FRT trigger does NOT fire for this message.
- [ ] **AC 5**: Given a conversation receives its first non-system outbound message after at least one inbound message, when the trigger fires, then `first_response_at` is set and `first_response_seconds` is the delta in seconds from the first inbound.
- [ ] **AC 6**: Given two outbound messages are inserted concurrently for the same conversation, when both triggers fire, then only the first one sets `first_response_at` (the second UPDATE is a no-op due to `WHERE first_response_at IS NULL`).
- [ ] **AC 7**: Given the RPC `get_messaging_metrics` is called with a valid `p_org_id`, when the caller belongs to that org, then it returns JSONB with `messagesSent`, `contacts`, `sla`, and `responseRate`.
- [ ] **AC 8**: Given the RPC is called with an `p_org_id` the caller does NOT belong to, when executed, then it raises an 'Unauthorized' exception.
- [ ] **AC 9**: Given the dashboard loads with period "Este Mês", when `MessagingMetricsSection` renders, then it shows 4 cards with data from `get_messaging_metrics`.
- [ ] **AC 10**: Given a user selects a seller in the dropdown, when the filter applies, then the hook re-fetches with `p_user_id` and all metrics reflect only that seller.
- [ ] **AC 11**: Given no outbound messages exist in the selected period, when the section renders, then it shows empty state.
- [ ] **AC 12**: Given data is loading, when the section renders, then it shows skeleton placeholders.
- [ ] **AC 13**: Given conversations where the contact's `created_at` is within the selected period, when counting, then they are "Novos Contatos". Contacts created before the period are "Follow-ups". Conversations without `contact_id` are excluded.
- [ ] **AC 14**: Given `PeriodFilter = 'all'`, when the RPC executes, then `p_start_date` is capped at 365 days ago (no full table scan).

## Additional Context

### Dependencies

- **Nenhuma dependência externa nova**.
- **Migration deve ser aplicada antes** de qualquer teste.
- **PeriodFilter**: Importado de `features/dashboard/hooks/useDashboardMetrics` — sem mudanças.

### Testing Strategy

- **Migration + Trigger (SQL tests no Supabase Dashboard)**:
  - Insert inbound msg → insert outbound com `sender_type = 'user'` → verificar FRT calculado
  - Insert segundo outbound → verificar FRT inalterado (race guard)
  - Insert outbound com `sender_type = 'system'` → verificar FRT NÃO calculado
  - Insert outbound sem inbound prévio → verificar FRT NULL
- **RPC (SQL test)**:
  - Chamar com `auth.uid()` pertencente à org → retorna dados
  - Chamar com `auth.uid()` de outra org → raise exception
  - Chamar com `p_start_date` > 365 dias → cap aplicado
- **Hook (unit test)**: `test/stories/US-MSG-001-messaging-metrics.test.tsx`
  - Mock `supabase.rpc()` com dados fixture
  - Testar `periodToDateRange()` pra cada valor de `PeriodFilter` (11 cases)
  - Testar que `userId` é passado à RPC quando selecionado
- **Componente (unit test)**:
  - Renderizar com dados mockados → 4 cards visíveis
  - Renderizar loading → skeletons visíveis
  - Renderizar empty → empty state visível
  - Selecionar vendedor → hook re-chamado com userId

### Notes

- **Mensagens antigas**: Sem `sender_user_id`/`sender_type`. A RPC conta como `'unknown'` no byType. Aceitável.
- **`AIMetricsSection` inconsistência**: Não usa `period` prop (hardcoded "this month"). Reconhecido, não corrigido nesta spec. Future improvement.
- **`messagingMetrics` invalidação**: Top-level key independente. `queryClient.invalidateQueries({ queryKey: ['messagingMetrics'] })` invalida tudo. Não há parent `messaging` compartilhado (debt arquitetural existente).
- **RPC `SECURITY DEFINER`**: Roda com permissões do owner da function. Seguro porque valida `auth.uid()` + org membership antes de processar.
- **Sender impersonation**: Impossível via API — `sender_user_id` é setado server-side a partir do token JWT. O client não envia esse campo. Não precisa de RLS extra.
