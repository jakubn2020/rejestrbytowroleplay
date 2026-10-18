import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
