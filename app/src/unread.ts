import { File, Paths } from 'expo-file-system';
import { setBadgeCount } from '../modules/herdline-badge';
import type { Contact, Message } from './api';

// When the person last looked at each conversation, as the time of the newest message they saw.
// A conversation is unread when its latest message is a reply newer than that.
let seen: Record<string, number> | null = null;
let latest: Contact[] = [];
const listeners = new Set<() => void>();

const time = (m: Pick<Message, 'ts'>) => Date.parse(m.ts) || 0;

function file(): File | null {
  try {
    return new File(Paths.document, 'seen.json');
  } catch {
    // No file system (web preview): kept in memory only.
    return null;
  }
}

function load(): Record<string, number> | null {
  if (seen) return seen;
  try {
    const f = file();
    if (f?.exists) seen = JSON.parse(f.textSync()) ?? {};
  } catch {
    // A broken file is treated like a first run.
  }
  return seen;
}

function save(): void {
  try {
    file()?.write(JSON.stringify(seen ?? {}));
  } catch {
    // The in-memory copy still works until the app closes.
  }
}

export function isUnread(contact: Contact): boolean {
  const preview = contact.preview;
  return !!preview && preview.role === 'assistant' && time(preview) > (load()?.[contact.id] ?? 0);
}

const unreadCount = () => latest.filter(isUnread).length;

/** Remember the contacts, update the icon badge and return how many have a new reply. */
export async function updateUnread(contacts: Contact[]): Promise<number> {
  latest = contacts;
  if (!load()) {
    // First run: what is already there counts as seen, so old history does not light up.
    seen = Object.fromEntries(contacts.filter((c) => c.preview).map((c) => [c.id, time(c.preview!)]));
    save();
  } else {
    const ids = new Set(contacts.map((c) => c.id));
    const kept = Object.fromEntries(Object.entries(seen!).filter(([id]) => ids.has(id)));
    if (Object.keys(kept).length !== Object.keys(seen!).length) {
      seen = kept;
      save();
    }
  }
  const count = unreadCount();
  await setBadgeCount(count);
  return count;
}

/** The person is looking at this conversation, whose newest message is `message`. */
export function markSeen(contactId: string, message: Message): void {
  // Before the first list load there is nothing to compare with; that load counts everything as seen.
  const current = load();
  if (!current || (current[contactId] ?? 0) >= time(message)) return;
  seen = { ...current, [contactId]: time(message) };
  save();
  setBadgeCount(unreadCount());
  listeners.forEach((listener) => listener());
}

export function onSeenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
