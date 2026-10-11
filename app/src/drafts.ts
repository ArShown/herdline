import { File, Paths } from 'expo-file-system';
import type { Marked } from './MarkupViewer';
import type { OutgoingFile } from './api';

export type Draft = { text: string; picked: Marked[]; files: OutgoingFile[] };

const EMPTY: Draft = { text: '', picked: [], files: [] };

// Attachments are kept only while the app runs; the text is also written to disk so it survives a restart.
const memory = new Map<string, Draft>();
let saved: Record<string, string> | null = null;

function file(): File | null {
  try {
    return new File(Paths.document, 'drafts.json');
  } catch {
    // No file system (web preview): drafts stay in memory.
    return null;
  }
}

function savedTexts(): Record<string, string> {
  if (saved) return saved;
  let texts: Record<string, string> = {};
  try {
    const f = file();
    if (f?.exists) texts = JSON.parse(f.textSync()) ?? {};
  } catch {
    // A broken file only loses old drafts.
  }
  saved = texts;
  return texts;
}

export function loadDraft(contactId: string): Draft {
  return memory.get(contactId) ?? { ...EMPTY, text: savedTexts()[contactId] ?? '' };
}

export function saveDraft(contactId: string, draft: Draft): void {
  if (draft.text || draft.picked.length || draft.files.length) memory.set(contactId, draft);
  else memory.delete(contactId);

  const texts = savedTexts();
  if ((texts[contactId] ?? '') === draft.text) return;
  if (draft.text) texts[contactId] = draft.text;
  else delete texts[contactId];
  try {
    file()?.write(JSON.stringify(texts));
  } catch {
    // Keep the in-memory copy if the disk write fails.
  }
}
