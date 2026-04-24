-- ============================================================
-- Fix: Apply missing RLS policies and performance indexes
--
-- The migrations 20260224000000 and 20260224000001 failed in
-- production because:
--   1. 20260224000000 tried to create an index on
--      messaging_webhook_events.organization_id (column doesn't exist)
--   2. This caused the entire transaction to roll back, including
--      the get_user_org_id() function creation
--   3. 20260224000001 then failed because it depended on that function
--
-- Result: business_units table has no SELECT policy, returning 404
--
-- This migration re-applies everything, skipping the bad index.
-- ============================================================


-- ============================================================
-- SECTION 1: organization_id single-column indexes (HIGH priority)
-- Every table that is filtered/scanned by org at the RLS layer
-- must have this index or all multi-tenant queries degrade to
-- sequential scans on the full table.
-- ============================================================

-- All CREATE INDEX statements wrapped in a single DO block that
-- skips indexes whose target table does not exist in this env.
DO $$
BEGIN
  -- Section 1: single-column org_id indexes
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='activities') THEN
    CREATE INDEX IF NOT EXISTS idx_activities_organization_id ON public.activities(organization_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='contacts') THEN
    CREATE INDEX IF NOT EXISTS idx_contacts_organization_id ON public.contacts(organization_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='deals') THEN
    CREATE INDEX IF NOT EXISTS idx_deals_organization_id ON public.deals(organization_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='leads') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_organization_id ON public.leads(organization_id);
  END IF;

  -- Section 2: composite indexes
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='contacts') THEN
    CREATE INDEX IF NOT EXISTS idx_contacts_org_stage ON public.contacts(organization_id, stage);
    CREATE INDEX IF NOT EXISTS idx_contacts_org_status ON public.contacts(organization_id, status);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='deals') THEN
    CREATE INDEX IF NOT EXISTS idx_deals_org_board ON public.deals(organization_id, board_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='activities') THEN
    CREATE INDEX IF NOT EXISTS idx_activities_org_date ON public.activities(organization_id, date DESC);
  END IF;

  -- Section 3: messaging_conversations composite (status + last_message_at)
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='messaging_conversations') THEN
    CREATE INDEX IF NOT EXISTS idx_messaging_conversations_status_last_msg
      ON public.messaging_conversations(status, last_message_at DESC);
  END IF;
END $$;

-- NOTE: Skipping idx_ai_decisions_organization_id because
-- ai_decisions doesn't have organization_id (uses user_id instead).
-- NOTE: Skipping idx_messaging_webhook_events_organization_id
-- because the column doesn't exist in that table. Use channel_id instead.


-- ============================================================
-- SECTION 4: Cached RLS org lookup helper
--
-- get_user_org_id() replaces inline subqueries of the form:
--   (SELECT organization_id FROM profiles WHERE id = auth.uid())
-- inside RLS policies.
--
-- STABLE + SECURITY DEFINER allows Postgres to cache the result
-- for the duration of a single SQL statement, so each multi-row
-- RLS check pays the profile lookup cost only once rather than
-- once per row.
--
-- Restricted to `authenticated` role only — anon and public
-- have no business calling this function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
$$;

-- Lock down execution: strip default PUBLIC grant, then grant
-- only to authenticated users.
REVOKE ALL ON FUNCTION public.get_user_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_id() TO authenticated;

COMMENT ON FUNCTION public.get_user_org_id() IS
  'Returns the organization_id for the currently authenticated user. '
  'STABLE + SECURITY DEFINER enables per-statement result caching inside '
  'RLS policies, eliminating repeated profile lookups.';


-- ============================================================
-- SECTION 5: RLS Policies (from 20260224000001)
--
-- All policies now use get_user_org_id() for org isolation.
-- Wrapped in DO blocks that skip tables not present in the
-- target schema (some envs may not have applied earlier
-- migrations that created these tables).
-- ============================================================

-- Helper: apply org_isolate (FOR ALL) policy if table exists
DO $$
DECLARE
  t text;
  tables_for_all text[] := ARRAY[
    'activities','boards','board_stages','contacts','crm_companies',
    'custom_field_definitions','deals','deal_items','leads','products',
    'tags','system_notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables_for_all
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_isolate', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (organization_id = public.get_user_org_id()) WITH CHECK (organization_id = public.get_user_org_id())',
        t || '_org_isolate', t
      );
    END IF;
  END LOOP;
END $$;

-- Apply SELECT-only org policy on tables that exist
DO $$
DECLARE
  t text;
  tables_for_select text[] := ARRAY[
    'security_alerts','audit_logs','contact_merge_log','deal_activities',
    'ai_feature_flags','ai_prompt_templates','organization_invites',
    'organization_settings','business_units','lead_routing_rules',
    'messaging_channels','stage_ai_config'
  ];
  policy_name text;
BEGIN
  FOREACH t IN ARRAY tables_for_select
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      policy_name := CASE
        WHEN t IN ('security_alerts','audit_logs','contact_merge_log','deal_activities')
          THEN t || '_org_select'
        ELSE t || '_select'
      END;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id())',
        policy_name, t
      );
    END IF;
  END LOOP;
END $$;

-- deal_activities also needs an INSERT policy
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'deal_activities') THEN
    DROP POLICY IF EXISTS "deal_activities_org_insert" ON public.deal_activities;
    CREATE POLICY "deal_activities_org_insert" ON public.deal_activities
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.get_user_org_id());
  END IF;
END $$;

-- ai_qualification_templates needs special policy (allows is_system=true)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_qualification_templates') THEN
    DROP POLICY IF EXISTS "ai_qualification_templates_select" ON public.ai_qualification_templates;
    CREATE POLICY "ai_qualification_templates_select" ON public.ai_qualification_templates
      FOR SELECT TO authenticated
      USING (
        is_system = true
        OR organization_id = public.get_user_org_id()
      );
  END IF;
END $$;


-- ============================================================
-- SECTION 6: contacts.ai_paused column (from 20260406130000)
--
-- Migration 20260406130000 may not have been applied in all
-- environments. This ensures the column exists idempotently.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contacts') THEN
    ALTER TABLE public.contacts
      ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT FALSE;

    COMMENT ON COLUMN public.contacts.ai_paused IS
      'When true, AI auto-responses are disabled for all conversations with this contact.';
  END IF;
END $$;


-- ============================================================
-- SECTION 7: messaging_conversations RLS — simplified org check
--
-- The original policy "Users view conversations in accessible units"
-- requires business_unit_members membership, which excludes non-admin
-- users from seeing conversations unless they are explicitly assigned
-- to the conversation's business unit.
--
-- Replace with a simpler org-level policy so all authenticated users
-- in the organization can read conversations.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'messaging_conversations') THEN
    DROP POLICY IF EXISTS "Users view conversations in accessible units" ON public.messaging_conversations;
    DROP POLICY IF EXISTS "messaging_conversations_select" ON public.messaging_conversations;
    CREATE POLICY "messaging_conversations_select" ON public.messaging_conversations
      FOR SELECT TO authenticated
      USING (organization_id = public.get_user_org_id());

    DROP POLICY IF EXISTS "Users update conversations they can access" ON public.messaging_conversations;
    DROP POLICY IF EXISTS "messaging_conversations_update" ON public.messaging_conversations;
    CREATE POLICY "messaging_conversations_update" ON public.messaging_conversations
      FOR UPDATE TO authenticated
      USING (organization_id = public.get_user_org_id())
      WITH CHECK (organization_id = public.get_user_org_id());

    DROP POLICY IF EXISTS "System can insert conversations" ON public.messaging_conversations;
    DROP POLICY IF EXISTS "messaging_conversations_insert" ON public.messaging_conversations;
    CREATE POLICY "messaging_conversations_insert" ON public.messaging_conversations
      FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.get_user_org_id());

    DROP POLICY IF EXISTS "messaging_conversations_delete" ON public.messaging_conversations;
    CREATE POLICY "messaging_conversations_delete" ON public.messaging_conversations
      FOR DELETE TO authenticated
      USING (organization_id = public.get_user_org_id());
  END IF;
END $$;
