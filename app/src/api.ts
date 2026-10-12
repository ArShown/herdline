export type Status = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  images?: string[];
  files?: string[];
  /** A shell command run in the session ("!" at the computer); `text` is the command. `compact` marks where the conversation was compacted. */
  kind?: 'command' | 'compact';
  output?: string;
};

export type AgentState = 'blocked' | 'working' | 'quiet' | 'done';

/** An agent a conversation sent off; `depth` > 0 means another listed agent dispatched it. */
export type DispatchedAgent = {
  id: string;
  kind: string;
  name: string;
  type: string | null;
  description: string | null;
  state: AgentState;
  started: string | null;
  active: string | null;
  summary: string;
  depth: number;
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

async function call<T>(server: Server, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${server.url.replace(/\/+$/, '')}${path}`, {
    method,
    signal,
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
  contacts: (s: Server, signal?: AbortSignal) =>
    call<{ contacts: Contact[]; usage: string | null; away?: boolean }>(s, 'GET', '/api/contacts', undefined, signal),
  messages: (s: Server, id: string, before?: string, limit = 50) =>
    call<{
      status: Status;
      session_id: string;
      context_used: number | null;
      account: string | null;
      messages: Message[];
      has_more: boolean;
    }>(
      s,
      'GET',
      `${contactPath(id)}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  send: (s: Server, id: string, text: string, images: OutgoingImage[] = [], files: OutgoingFile[] = []) =>
    call(s, 'POST', `${contactPath(id)}/messages`, { text, images, files }),
  agents: (s: Server, id: string) =>
    call<{ agents: DispatchedAgent[] }>(s, 'GET', `${contactPath(id)}/agents`).then((d) => d.agents),
  run: (s: Server, id: string, command: string) => call(s, 'POST', `${contactPath(id)}/run`, { command }),
  compact: (s: Server, id: string) => call(s, 'POST', `${contactPath(id)}/compact`, {}),
  rename: (s: Server, id: string, name: string) =>
    call<{ name: string }>(s, 'POST', `${contactPath(id)}/rename`, { name }).then((d) => d.name),
  screen: (s: Server, id: string) => call<{ text: string }>(s, 'GET', `${contactPath(id)}/screen`).then((d) => d.text),
  keys: (s: Server, id: string, keys: string[]) => call(s, 'POST', `${contactPath(id)}/keys`, { keys }),
  exit: (s: Server, id: string, force = false) => call(s, 'POST', `${contactPath(id)}/exit`, { force }),
  createSpace: (s: Server) => call<{ id: string; name: string; status: Status }>(s, 'POST', '/api/spaces', {}),
};
