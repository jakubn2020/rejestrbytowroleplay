import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const practitioners = pgTable('practitioners', {
  id: serial().primaryKey(),
  pesel: text().notNull().unique(),
  pwz: text().notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  profession: text().notNull(),
  specialization: text(),
  /** E-mail (or id) of the staff account that added the entry; null for older rows. */
  createdBy: text('created_by'),
  /** 'active' | 'suspended' | 'expired' (see ENTRY_STATUSES in src/lib/registry.ts). */
  status: text().notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** Set when the entry is moved to the trash; null for live entries. */
  deletedAt: timestamp('deleted_at'),
})

export type Practitioner = typeof practitioners.$inferSelect

/** Who did what and when. Visible to admins only. */
export const auditLog = pgTable('audit_log', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  actor: text().notNull(),
  actorRole: text('actor_role').notNull(),
  action: text().notNull(),
  target: text(),
  details: text(),
})

export type AuditEntry = typeof auditLog.$inferSelect

/** Small key/value store (e.g. the uploaded seal image used on certificates). */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: text().notNull(),
})

/** Last time each `kierownictwo` account added an entry; claimed atomically. */
export const cooldowns = pgTable('cooldowns', {
  identity: text().primaryKey(),
  lastAt: timestamp('last_at').defaultNow().notNull(),
})

/** Numeric public lookups per IP, used to limit PESEL/PWZ guessing. */
export const searchAttempts = pgTable('search_attempts', {
  id: serial().primaryKey(),
  ip: text().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

/** One-time e-mail login codes (hashed). */
export const loginCodes = pgTable('login_codes', {
  id: serial().primaryKey(),
  identity: text().notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer().notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

/** Browsers that passed the e-mail code step (cookie holds the token, only its hash is stored). */
export const mfaSessions = pgTable('mfa_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  identity: text().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
})

/** A kierownictwo request to add a person; an admin approves or rejects it (with a screenshot as proof). */
export const entryRequests = pgTable('entry_requests', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  requestedBy: text('requested_by').notNull(),
  pesel: text().notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  profession: text().notNull(),
  specialization: text(),
  /** Screenshot of the message in which the person asks for the entry (image data URL). */
  proof: text().notNull(),
  /** 'pending' | 'approved' | 'rejected' */
  status: text().notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at'),
  note: text(),
})
