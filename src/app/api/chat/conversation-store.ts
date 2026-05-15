import fs from 'fs';
import path from 'path';

/**
 * File-based fallback store for conversation archive/hidden state.
 * Used when the `is_archived` and `is_hidden` columns don't exist
 * in the `conversation_participants` database table.
 */

interface ConvSettings {
  is_archived?: boolean;
  is_hidden?: boolean;
}

// In-memory cache for fast access
let cache: Record<string, ConvSettings> | null = null;

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'conversation-settings.json');

function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, '{}', 'utf-8');
  }
}

function readStore(): Record<string, ConvSettings> {
  if (cache) return cache;
  try {
    ensureFile();
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    cache = JSON.parse(raw);
    return cache!;
  } catch {
    cache = {};
    return cache;
  }
}

function writeStore(data: Record<string, ConvSettings>): void {
  try {
    ensureFile();
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    cache = data;
  } catch (err) {
    console.error('[ConversationStore] Write error:', err);
  }
}

function key(userId: string, conversationId: string): string {
  return `${userId}::${conversationId}`;
}

export function getConvSettings(userId: string, conversationId: string): ConvSettings {
  const store = readStore();
  return store[key(userId, conversationId)] || {};
}

export function getAllUserSettings(userId: string): Map<string, ConvSettings> {
  const store = readStore();
  const result = new Map<string, ConvSettings>();
  for (const [k, v] of Object.entries(store)) {
    if (k.startsWith(`${userId}::`)) {
      const convId = k.split('::')[1];
      result.set(convId, v);
    }
  }
  return result;
}

export function setArchived(userId: string, conversationId: string, archived: boolean): void {
  const store = readStore();
  const k = key(userId, conversationId);
  store[k] = { ...store[k], is_archived: archived };
  writeStore(store);
}

export function setHidden(userId: string, conversationId: string, hidden: boolean): void {
  const store = readStore();
  const k = key(userId, conversationId);
  store[k] = { ...store[k], is_hidden: hidden };
  writeStore(store);
}
