export type CrmToolCatalogEntry = {
  /** MCP tool name (stable identifier). */
  name: string;
  /** Optional UI-friendly name. */
  title: string;
  /** Human-readable description used by MCP clients / models. */
  description: string;
};

/**
 * Canonical MCP catalog for CRM tools exposed from `createCRMTools`.
 *
 * Naming conventions follow MCP tool naming guidance:
 * - stable
 * - 1–128 chars
 * - only ASCII letters/digits/underscore/hyphen/dot (and no spaces)
 *
 * Keep these values **English** and **short** to maximize client interoperability.
 */
export const CRM_TOOL_CATALOG = {
  analyzePipeline: {
    name: 'crm.pipeline.analyze',
    title: 'Analyze pipeline',
    description:
      'Read-only. Aggregates pipeline metrics and stage breakdown for a board within the authenticated organization.',
  },
  getBoardMetrics: {
    name: 'crm.boards.metrics.get',
    title: 'Get board metrics',
    description:
      'Read-only. Computes core KPIs for a board (win rate, open/won/lost counts, pipeline value) scoped to the authenticated organization.',
  },

  searchDeals: {
    name: 'crm.deals.search',
    title: 'Search deals',
    description:
      'Read-only. Searches deals by title (substring/term match) within the authenticated organization. Supports limiting results.',
  },
  getDealDetails: {
    name: 'crm.deals.get',
    title: 'Get deal details',
    description:
      'Read-only. Returns full deal details (including stage, contact, and activities) scoped to the authenticated organization.',
  },
  listDealsByStage: {
    name: 'crm.deals.list_by_stage',
    title: 'List deals by stage',
    description:
      'Read-only. Lists open deals in a specific stage (by `stageId` or `stageName`) for a given board within the authenticated organization.',
  },
  listStagnantDeals: {
    name: 'crm.deals.list_stagnant',
    title: 'List stagnant deals',
    description:
      'Read-only. Lists open deals not updated for N days within the authenticated organization.',
  },
  listOverdueDeals: {
    name: 'crm.deals.list_overdue',
    title: 'List overdue deals',
    description:
      'Read-only. Lists deals that have overdue, incomplete activities within the authenticated organization.',
  },

  createDeal: {
    name: 'crm.deals.create',
    title: 'Create deal',
    description:
      'Writes data. Creates a new deal in a target board (or context board). May create/link a contact. Scoped to the authenticated organization.',
  },
  updateDeal: {
    name: 'crm.deals.update',
    title: 'Update deal',
    description:
      'Writes data. Updates mutable fields of an existing deal (e.g., title/value/priority) within the authenticated organization.',
  },
  moveDeal: {
    name: 'crm.deals.move',
    title: 'Move deal',
    description:
      'Writes data. Moves a deal to a destination stage within the authenticated organization.',
  },
  markDealAsWon: {
    name: 'crm.deals.mark_won',
    title: 'Mark deal as won',
    description:
      'Writes data. Marks a deal as won (optionally updates value and stage when resolvable) within the authenticated organization.',
  },
  markDealAsLost: {
    name: 'crm.deals.mark_lost',
    title: 'Mark deal as lost',
    description:
      'Writes data. Marks a deal as lost and records a required loss reason within the authenticated organization.',
  },
  assignDeal: {
    name: 'crm.deals.assign',
    title: 'Assign deal owner',
    description:
      'Writes data. Reassigns a deal to a new owner (`newOwnerId`) within the authenticated organization.',
  },
  moveDealsBulk: {
    name: 'crm.deals.bulk_move',
    title: 'Bulk move deals',
    description:
      'Writes data. Moves multiple deals to a destination stage with guardrails (max deals) and optional follow-up task creation.',
  },

  searchContacts: {
    name: 'crm.contacts.search',
    title: 'Search contacts',
    description:
      'Read-only. Searches contacts by name or email within the authenticated organization.',
  },
  getContactDetails: {
    name: 'crm.contacts.get',
    title: 'Get contact details',
    description:
      'Read-only. Returns contact details within the authenticated organization.',
  },
  createContact: {
    name: 'crm.contacts.create',
    title: 'Create contact',
    description:
      'Writes data. Creates a new contact within the authenticated organization.',
  },
  updateContact: {
    name: 'crm.contacts.update',
    title: 'Update contact',
    description:
      'Writes data. Updates mutable contact fields within the authenticated organization.',
  },
  linkDealToContact: {
    name: 'crm.deals.link_contact',
    title: 'Link deal to contact',
    description:
      'Writes data. Links an existing deal to an existing contact (sets `deal.contact_id`) within the authenticated organization.',
  },

  listActivities: {
    name: 'crm.activities.list',
    title: 'List activities',
    description:
      'Read-only. Lists activities with filters (board/deal/contact, completed, date range) within the authenticated organization.',
  },
  createTask: {
    name: 'crm.activities.create_task',
    title: 'Create activity',
    description:
      'Writes data. Creates an activity (TASK/CALL/MEETING/EMAIL) optionally linked to a deal within the authenticated organization.',
  },
  completeActivity: {
    name: 'crm.activities.complete',
    title: 'Complete activity',
    description:
      'Writes data. Marks an activity as completed within the authenticated organization.',
  },
  rescheduleActivity: {
    name: 'crm.activities.reschedule',
    title: 'Reschedule activity',
    description:
      'Writes data. Updates an activity’s scheduled date/time within the authenticated organization.',
  },
  logActivity: {
    name: 'crm.activities.log',
    title: 'Log activity',
    description:
      'Writes data. Logs an interaction already completed (CALL/MEETING/EMAIL/TASK), optionally linked to a deal/contact, within the authenticated organization.',
  },

  addDealNote: {
    name: 'crm.deal_notes.add',
    title: 'Add deal note',
    description:
      'Writes data. Adds a note to a deal within the authenticated organization.',
  },
  listDealNotes: {
    name: 'crm.deal_notes.list',
    title: 'List deal notes',
    description:
      'Read-only. Lists the latest notes for a deal within the authenticated organization.',
  },

  listStages: {
    name: 'crm.stages.list',
    title: 'List board stages',
    description:
      'Read-only. Lists stages (columns) for a board within the authenticated organization.',
  },
  updateStage: {
    name: 'crm.stages.update',
    title: 'Update stage',
    description:
      'Writes data. Updates stage fields (name/label/color/order/default) within the authenticated organization.',
  },
  reorderStages: {
    name: 'crm.stages.reorder',
    title: 'Reorder stages',
    description:
      'Writes data. Reorders stages for a board (ordered list of stage IDs) within the authenticated organization.',
  },
  // ── Messaging ────────────────────────────────────────────────────────────

  listChannels: {
    name: 'crm.channels.list',
    title: 'List channels',
    description:
      'Read-only. Lists messaging channels (WhatsApp, Instagram, Email, etc.) for the authenticated organization. Credentials are never returned.',
  },
  listConversations: {
    name: 'crm.conversations.list',
    title: 'List conversations',
    description:
      'Read-only. Lists messaging conversations with optional filters (channelId, contactId, status). Includes contact name via join. Scoped to the authenticated organization.',
  },
  getConversation: {
    name: 'crm.conversations.get',
    title: 'Get conversation',
    description:
      'Read-only. Returns a single conversation with its most recent messages, contact, and channel info. Scoped to the authenticated organization.',
  },
  sendMessage: {
    name: 'crm.messages.send',
    title: 'Send message',
    description:
      'Writes data. Queues a text message for sending in an existing conversation. The message is inserted as "pending" and dispatched by the messaging worker. Scoped to the authenticated organization.',
  },
  searchMessages: {
    name: 'crm.messages.search',
    title: 'Search messages',
    description:
      'Read-only. Full-text search over message content within the authenticated organization. Joins through conversations to enforce org scoping.',
  },
  retryMessage: {
    name: 'crm.messages.retry',
    title: 'Retry failed message',
    description:
      'Writes data. Resets a failed message back to "pending" status so it will be retried by the messaging worker. Scoped to the authenticated organization.',
  },
  listTemplates: {
    name: 'crm.templates.list',
    title: 'List message templates',
    description:
      'Read-only. Lists HSM (WhatsApp) message templates, optionally filtered by channel. Scoped to the authenticated organization via channel ownership.',
  },
  syncTemplates: {
    name: 'crm.templates.sync',
    title: 'Sync message templates',
    description:
      'Initiates a template sync with the provider (Meta). Requires Meta API credentials — must be done via the web UI.',
  },
} as const satisfies Record<string, CrmToolCatalogEntry>;

export type CrmInternalToolKey = keyof typeof CRM_TOOL_CATALOG;

export function getCrmCatalogEntry(key: string): CrmToolCatalogEntry | undefined {
  return (CRM_TOOL_CATALOG as Record<string, CrmToolCatalogEntry | undefined>)[key];
}

