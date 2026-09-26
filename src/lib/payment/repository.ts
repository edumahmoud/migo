/**
 * Payment Gateway Core — Repository
 *
 * Database access layer for the `payment_gateways` table.
 * Handles:
 *   - Reading gateway configs (with encrypted credential decryption)
 *   - Writing gateway configs (with credential encryption)
 *   - Enforcing the "only one default" rule
 *
 * This is the ONLY layer that touches the `payment_gateways` table.
 * It never returns decrypted credentials to the caller — it returns
 * them only inside the GatewayCredentials container which is passed
 * directly to the adapter.
 */

import { supabaseServer } from '@/lib/supabase-server';
import { encrypt, decrypt, isEncryptionKeyConfigured } from './crypto';
import {
  GatewayConfigurationInvalidError,
  CredentialsMissingError,
  EncryptionKeyMissingError,
} from './errors';
import type {
  GatewayProvider,
  GatewayEnvironment,
  GatewayCapabilities,
  GatewayCredentials,
  GatewayConfiguration,
  GatewayMetadata,
} from './types';

// ─── Database row shape (what's in the table) ───
interface PaymentGatewayRow {
  id: string;
  provider: string;
  display_name: string;
  environment: string;
  is_enabled: boolean;
  is_default: boolean;
  credentials_encrypted: string | null;
  configuration_encrypted: string | null;
  capabilities: GatewayCapabilities | null;
  created_at: string;
  updated_at: string;
}

// ─── Resolved gateway (after decrypting credentials) ───
export interface ResolvedGateway {
  id: string;
  provider: GatewayProvider;
  displayName: string;
  environment: GatewayEnvironment;
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: GatewayCapabilities;
  credentials: GatewayCredentials;     // decrypted
  configuration: GatewayConfiguration;  // decrypted
}

// ─── Public metadata (no secrets) ───
export function rowToMetadata(row: PaymentGatewayRow): GatewayMetadata {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    environment: row.environment as GatewayEnvironment,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
    capabilities: row.capabilities ?? {
      supportsRefund: false,
      supportsVerify: false,
      supportsWebhook: false,
      supportsTestConnection: false,
      supportsRedirectCheckout: false,
      supportsEmbeddedCheckout: false,
    },
  };
}

// ─── Read operations ───

/**
 * Get the default gateway (is_default=true).
 * Returns null if no default is configured.
 */
export async function getDefaultGateway(): Promise<ResolvedGateway | null> {
  const { data, error } = await supabaseServer
    .from('payment_gateways')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();

  if (error || !data) return null;
  return resolveRow(data as PaymentGatewayRow);
}

/**
 * Get a gateway by provider + environment.
 */
export async function getGateway(
  provider: GatewayProvider,
  environment: GatewayEnvironment,
): Promise<ResolvedGateway | null> {
  const { data, error } = await supabaseServer
    .from('payment_gateways')
    .select('*')
    .eq('provider', provider)
    .eq('environment', environment)
    .maybeSingle();

  if (error || !data) return null;
  return resolveRow(data as PaymentGatewayRow);
}

/**
 * Get a gateway by ID.
 */
export async function getGatewayById(id: string): Promise<ResolvedGateway | null> {
  const { data, error } = await supabaseServer
    .from('payment_gateways')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return resolveRow(data as PaymentGatewayRow);
}

/**
 * List all gateways (metadata only — no decrypted credentials).
 */
export async function listGateways(): Promise<GatewayMetadata[]> {
  const { data, error } = await supabaseServer
    .from('payment_gateways')
    .select('*')
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as PaymentGatewayRow[]).map(rowToMetadata);
}

// ─── Write operations ───

export interface CreateGatewayInput {
  provider: GatewayProvider;
  displayName: string;
  environment: GatewayEnvironment;
  credentials?: GatewayCredentials;
  configuration?: GatewayConfiguration;
  capabilities?: GatewayCapabilities;
  setAsDefault?: boolean;
}

/**
 * Create a new gateway config. Credentials are encrypted before
 * storage.
 */
export async function createGateway(input: CreateGatewayInput): Promise<string> {
  if (!isEncryptionKeyConfigured()) {
    throw new EncryptionKeyMissingError();
  }

  const credentialsEncrypted = input.credentials ? encrypt(input.credentials) : null;
  const configurationEncrypted = input.configuration ? encrypt(input.configuration) : null;

  // If setAsDefault, clear any existing default first
  if (input.setAsDefault) {
    await supabaseServer
      .from('payment_gateways')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('is_default', true);
  }

  const { data, error } = await supabaseServer
    .from('payment_gateways')
    .insert({
      provider: input.provider,
      display_name: input.displayName,
      environment: input.environment,
      is_enabled: false,  // new gateways start disabled
      is_default: input.setAsDefault ?? false,
      credentials_encrypted: credentialsEncrypted,
      configuration_encrypted: configurationEncrypted,
      capabilities: input.capabilities ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new GatewayConfigurationInvalidError(input.provider, error.message);
  }

  return (data as { id: string }).id;
}

/**
 * Update a gateway's credentials/configuration.
 * Credentials are encrypted before storage.
 */
export async function updateGatewayConfig(
  id: string,
  credentials?: GatewayCredentials,
  configuration?: GatewayConfiguration,
): Promise<void> {
  if (!isEncryptionKeyConfigured() && (credentials || configuration)) {
    throw new EncryptionKeyMissingError();
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (credentials) update.credentials_encrypted = encrypt(credentials);
  if (configuration) update.configuration_encrypted = encrypt(configuration);

  await supabaseServer
    .from('payment_gateways')
    .update(update)
    .eq('id', id);
}

/**
 * Set a gateway as the default. Clears any existing default first.
 */
export async function setDefaultGateway(id: string): Promise<void> {
  // Clear existing default
  await supabaseServer
    .from('payment_gateways')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('is_default', true);

  // Set the new default
  await supabaseServer
    .from('payment_gateways')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Enable or disable a gateway.
 */
export async function setGatewayEnabled(id: string, enabled: boolean): Promise<void> {
  await supabaseServer
    .from('payment_gateways')
    .update({ is_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', id);
}

// ─── Internal helper: decrypt a row into a ResolvedGateway ───

function resolveRow(row: PaymentGatewayRow): ResolvedGateway {
  // Decrypt credentials (throw if missing key)
  let credentials: GatewayCredentials = {};
  if (row.credentials_encrypted) {
    try {
      credentials = decrypt(row.credentials_encrypted);
    } catch (err) {
      throw new GatewayConfigurationInvalidError(
        row.provider,
        'Failed to decrypt credentials — encryption key may have changed',
      );
    }
  }

  // Decrypt configuration (optional)
  let configuration: GatewayConfiguration = {};
  if (row.configuration_encrypted) {
    try {
      configuration = decrypt(row.configuration_encrypted);
    } catch {
      // Non-fatal — configuration is optional, just log + empty
      console.warn(`[payment:repository] Failed to decrypt configuration for gateway ${row.id}`);
    }
  }

  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    environment: row.environment as GatewayEnvironment,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
    capabilities: row.capabilities ?? {
      supportsRefund: false,
      supportsVerify: false,
      supportsWebhook: false,
      supportsTestConnection: false,
      supportsRedirectCheckout: false,
      supportsEmbeddedCheckout: false,
    },
    credentials,
    configuration,
  };
}
