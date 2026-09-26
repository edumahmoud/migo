/**
 * Payment Gateway Core — Audit Logger
 *
 * Records gateway management events for future compliance/auditing.
 * Events are stored in the `payment_gateway_audit_log` table.
 *
 * CRITICAL: Never store credentials, secrets, or encrypted blobs
 * in the audit log. The `details` field must only contain non-secret
 * context (e.g., "is_enabled changed from false to true").
 */

import { supabaseServer } from '@/lib/supabase-server';

export type GatewayAuditEvent =
  | 'gateway.created'
  | 'gateway.updated'
  | 'gateway.enabled'
  | 'gateway.disabled'
  | 'gateway.default_changed'
  | 'gateway.connection_tested';

export interface AuditLogEntry {
  gatewayId: string;
  event: GatewayAuditEvent;
  actorId?: string;
  details?: Record<string, unknown>;
}

/**
 * Log a gateway audit event to the database.
 *
 * @param entry Audit log entry (no secrets in `details`)
 */
export async function logGatewayAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await supabaseServer
      .from('payment_gateway_audit_log')
      .insert({
        gateway_id: entry.gatewayId,
        event: entry.event,
        actor_id: entry.actorId ?? null,
        details: entry.details ?? {},
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    // Audit logging failure must NOT crash the main operation.
    // Log the error but continue.
    console.error('[payment:audit] Failed to log audit event:', {
      gatewayId: entry.gatewayId,
      event: entry.event,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// ─── Helper functions for common audit patterns ───

export function auditGatewayCreated(gatewayId: string, provider: string, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.created',
    actorId,
    details: { provider },
  });
}

export function auditGatewayUpdated(gatewayId: string, changes: Record<string, unknown>, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.updated',
    actorId,
    // Only log which fields changed, NOT the new values of credential fields
    details: { changedFields: Object.keys(changes) },
  });
}

export function auditGatewayEnabled(gatewayId: string, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.enabled',
    actorId,
    details: {},
  });
}

export function auditGatewayDisabled(gatewayId: string, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.disabled',
    actorId,
    details: {},
  });
}

export function auditGatewayDefaultChanged(gatewayId: string, previousDefaultId: string | null, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.default_changed',
    actorId,
    details: { previousDefaultId },
  });
}

export function auditGatewayConnectionTested(gatewayId: string, success: boolean, message: string, actorId?: string): Promise<void> {
  return logGatewayAuditEvent({
    gatewayId,
    event: 'gateway.connection_tested',
    actorId,
    details: { success, message },
  });
}
