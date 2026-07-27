/**
 * @fileoverview Serviço Supabase para catálogo de produtos/serviços.
 *
 * Observação:
 * - O CRM é "adaptável": o catálogo é um acelerador (defaults).
 * - No deal, ainda permitimos itens personalizados (product_id pode ser NULL em deal_items).
 */

import { supabase } from './client';
import { Product, ProductObjection } from '@/types';
import { sanitizeUUID } from './utils';

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;

  const orgId = sanitizeUUID((profile as any)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

type DbProduct = {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  price: number;
  sku: string | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
  // Playbook de vendas — alimenta o Copiloto quando o produto está selecionado
  promise: string | null;
  audience: string | null;
  payment_terms: string | null;
  deliverables: string | null;
  checkout_url: string | null;
  objections: ProductObjection[] | null;
  copilot_enabled: boolean | null;
};

/**
 * Colunas lidas em toda consulta de produto — inclui o playbook de vendas.
 * Precisa ser uma string literal única: o supabase-js infere o tipo do retorno
 * a partir dela, e uma concatenação faz a inferência cair pra GenericStringError.
 */
const PRODUCT_COLUMNS = 'id, organization_id, name, description, price, sku, active, created_at, updated_at, owner_id, promise, audience, payment_terms, deliverables, checkout_url, objections, copilot_enabled' as const;

function transformProduct(db: DbProduct): Product {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    description: db.description || undefined,
    price: Number(db.price ?? 0),
    sku: db.sku || undefined,
    active: db.active ?? true,
    promise: db.promise || undefined,
    audience: db.audience || undefined,
    paymentTerms: db.payment_terms || undefined,
    deliverables: db.deliverables || undefined,
    checkoutUrl: db.checkout_url || undefined,
    objections: Array.isArray(db.objections) ? db.objections : [],
    copilotEnabled: db.copilot_enabled ?? true,
  };
}

/** Campos do playbook aceitos em create/update, no formato da UI (camelCase). */
export type ProductPlaybookInput = Partial<{
  promise: string;
  audience: string;
  paymentTerms: string;
  deliverables: string;
  checkoutUrl: string;
  objections: ProductObjection[];
  copilotEnabled: boolean;
}>;

/** Traduz o playbook de camelCase (UI) para snake_case (banco). */
function playbookToDb(input: ProductPlaybookInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.promise !== undefined) out.promise = input.promise.trim() || null;
  if (input.audience !== undefined) out.audience = input.audience.trim() || null;
  if (input.paymentTerms !== undefined) out.payment_terms = input.paymentTerms.trim() || null;
  if (input.deliverables !== undefined) out.deliverables = input.deliverables.trim() || null;
  if (input.checkoutUrl !== undefined) out.checkout_url = input.checkoutUrl.trim() || null;
  if (input.copilotEnabled !== undefined) out.copilot_enabled = input.copilotEnabled;
  if (input.objections !== undefined) {
    out.objections = input.objections.filter(o => o.q.trim() && o.a.trim());
  }
  return out;
}

export const productsService = {
  async getAll(): Promise<{ data: Product[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS)
        .order('created_at', { ascending: false });

      if (error) return { data: [], error };

      const rows = (data || []) as DbProduct[];
      // Por padrão mostramos só ativos na UI do deal; mas aqui retorna tudo para o Settings.
      return { data: rows.map(transformProduct), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(): Promise<{ data: Product[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) return { data: [], error };

      const rows = (data || []) as DbProduct[];
      return { data: rows.map(transformProduct), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(
    input: { name: string; price: number; sku?: string; description?: string } & ProductPlaybookInput
  ): Promise<{ data: Product | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('products')
        .insert({
          name: input.name,
          price: input.price,
          sku: input.sku || null,
          description: input.description || null,
          active: true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
          ...playbookToDb(input),
        })
        .select(PRODUCT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformProduct(data as DbProduct), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ name: string; price: number; sku?: string; description?: string; active: boolean }> & ProductPlaybookInput
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.price !== undefined) payload.price = updates.price;
      if (updates.sku !== undefined) payload.sku = updates.sku || null;
      if (updates.description !== undefined) payload.description = updates.description || null;
      if (updates.active !== undefined) payload.active = updates.active;
      Object.assign(payload, playbookToDb(updates));
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

