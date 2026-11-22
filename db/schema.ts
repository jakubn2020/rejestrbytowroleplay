import { sql } from 'drizzle-orm'
import { boolean, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
  /** End of the PWZ validity; null = lifetime. After this moment the entry counts as "expired". */
  expiresAt: timestamp('expires_at'),
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
  /** Address and browser of the person who did it (security trail). */
  ip: text(),
  userAgent: text('user_agent'),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  ip: text(),
  userAgent: text('user_agent'),
})

/**
 * Security trail: failed logins, rate-limit hits, PESEL reveals, new-address logins …
 * Rows with `isAlert` are shown to admins as alerts until acknowledged.
 */
export const securityEvents = pgTable('security_events', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  kind: text().notNull(),
  identity: text(),
  ip: text(),
  details: text(),
  isAlert: boolean('is_alert').notNull().default(false),
  acknowledged: boolean().notNull().default(false),
  /** Country code from Cloudflare (`T1` = Tor); null when unknown. */
  country: text(),
  /** 'low' | 'medium' | 'high' | 'critical' */
  severity: text().notNull().default('medium'),
})

/** Public reports of mistakes in the registry. */
export const reports = pgTable('reports', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** Which entry the report is about (PWZ and/or name, free text). */
  subject: text().notNull(),
  message: text().notNull(),
  contact: text(),
  /** 'open' | 'done' */
  status: text().notNull().default('open'),
  /** 'data' | 'removal' | 'question' | 'tech' | 'other' (null = old reports) */
  category: text(),
  handledBy: text('handled_by'),
  handledAt: timestamp('handled_at'),
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

/**
 * Staff accounts (replaces Netlify Identity). `roles` is a comma-free list stored as
 * text[]: 'admin' and/or 'kierownictwo'. Passwords are PBKDF2 hashes (see src/lib/password.ts).
 */
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  roles: text().array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
  locked: boolean().notNull().default(false),
  lockedReason: text('locked_reason'),
  frozenUntil: timestamp('frozen_until'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  weakPassword: boolean('weak_password').notNull().default(false),
  lastLoginAt: timestamp('last_login_at').defaultNow(),
})

export type User = typeof users.$inferSelect

/** Password-login sessions (cookie holds the token, only its hash is stored). */
export const authSessions = pgTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

/** A kierownictwo request to change the PWZ validity of an entry; an admin approves or rejects it. */
export const expiryRequests = pgTable('expiry_requests', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  requestedBy: text('requested_by').notNull(),
  practitionerId: integer('practitioner_id').notNull(),
  /** Copied from the entry so the request stays readable if the entry is later changed or deleted. */
  personName: text('person_name').notNull(),
  pwz: text().notNull(),
  /** 'lifetime' | 'months3' | 'custom' (custom uses amount + unit) */
  mode: text().notNull(),
  amount: integer(),
  /** 'days' | 'months' */
  unit: text(),
  /** Screenshot of the message (image data URL). */
  proof: text().notNull(),
  /** 'pending' | 'approved' | 'rejected' */
  status: text().notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at'),
  note: text(),
})

/** Page views per day and page (anonymous counters). `id` is "<day>|<path>". */
export const visitStats = pgTable('visit_stats', {
  id: text().primaryKey(),
  day: text().notNull(),
  path: text().notNull(),
  views: integer().notNull().default(0),
})

/** One row per anonymous visitor per day (salted hash, no IP address stored). `id` is "<day>|<hash>". */
export const visitUniques = pgTable('visit_uniques', {
  id: text().primaryKey(),
  day: text().notNull(),
})

/** Blocked or allowed addresses (single IP or CIDR range). `expiresAt` null = permanent. */
export const ipRules = pgTable('ip_rules', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** 'block' | 'allow' (allow rules form the whitelist for the admin panel) */
  kind: text().notNull(),
  rule: text().notNull(),
  reason: text(),
  createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at'),
  auto: boolean().notNull().default(false),
})

/** One-time password reset links (only the hash of the token is stored). */
export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

/** Requests to the public search/verification per minute and address. `id` is "<minute>|<ip>". */
export const traffic = pgTable('traffic', {
  id: text().primaryKey(),
  minute: text().notNull(),
  ip: text().notNull(),
  hits: integer().notNull().default(0),
})

/** Security incidents with the evidence frozen when they were opened. */
export const incidents = pgTable('incidents', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull(),
  title: text().notNull(),
  /** 'open' | 'closed' */
  status: text().notNull().default('open'),
  closedAt: timestamp('closed_at'),
  /** JSON copy of the latest audit log and security events at the moment of opening. */
  snapshot: text(),
  /** JSON list of ticked checklist item ids. */
  checklist: text().notNull().default('[]'),
})

export const incidentNotes = pgTable('incident_notes', {
  id: serial().primaryKey(),
  incidentId: integer('incident_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  author: text().notNull(),
  text: text().notNull(),
})

/** Registry backups (JSON of all entries that are not in the trash). */
export const backups = pgTable('backups', {
  id: serial().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull(),
  entries: integer().notNull(),
  data: text().notNull(),
})

/** Previous values of an entry before each edit, so the last changes can be undone. */
export const entryRevisions = pgTable('entry_revisions', {
  id: serial().primaryKey(),
  entryId: integer('entry_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  actor: text().notNull(),
  /** Human-readable list of what changed. */
  summary: text().notNull(),
  /** JSON: { pesel, pwz, specialization, status, expiresAt } as it was before the change. */
  before: text().notNull(),
})
