export type Status = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  images?: string[];
  files?: string[];
};

export type OutgoingImage = { type: string; data: string };
export type OutgoingFile = { name: string; data: string };

export type Contact = {
  id: string;
  name: string;
  status: Status;
  title: string | null;
  context_used: number | null;
  account?: string | null;
  preview: Message | null;
};

export type Server = { url: string; token: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function call<T>(server: Server, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${server.url.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${server.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed');
  return data as T;
}

export const imageUrl = (s: Server, path: string) => `${s.url.replace(/\/+$/, '')}${path}`;

const contactPath = (id: string) => `/api/contacts/${encodeURIComponent(id)}`;

export const api = {
  contacts: (s: Server) => call<{ contacts: Contact[]; usage: string | null; away?: boolean }>(s, 'GET', '/api/contacts'),
  messages: (s: Server, id: string, before?: string, limit = 50) =>
    call<{ status: Status; session_id: string; account: string | null; messages: Message[]; has_more: boolean }>(
      s,
      'GET',
      `${contactPath(id)}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  send: (s: Server, id: string, text: string, images: OutgoingImage[] = [], files: OutgoingFile[] = []) =>
    call(s, 'POST', `${contactPath(id)}/messages`, { text, images, files }),
  screen: (s: Server, id: string) => call<{ text: string }>(s, 'GET', `${contactPath(id)}/screen`).then((d) => d.text),
  keys: (s: Server, id: string, keys: string[]) => call(s, 'POST', `${contactPath(id)}/keys`, { keys }),
  exit: (s: Server, id: string, force = false) => call(s, 'POST', `${contactPath(id)}/exit`, { force }),
  createSpace: (s: Server) => call<{ id: string; name: string; status: Status }>(s, 'POST', '/api/spaces', {}),
};
