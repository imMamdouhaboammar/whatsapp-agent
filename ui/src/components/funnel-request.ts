import { record } from '../api/response-contracts';

const readObject = (text: string): Record<string, unknown> | undefined => {
  if (!text.trim()) return undefined;
  const value: unknown = JSON.parse(text);
  if (!record(value)) throw new Error('Expected JSON object');
  return value;
};

export function parseFunnelRequest(payload: string, query: string): {
  payload?: Record<string, unknown>;
  queryParams?: Record<string, string>;
} {
  const body = readObject(payload);
  const params = readObject(query);
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value !== 'string') throw new Error('Query values must be strings');
    entries.push([key, value]);
  }
  return { payload: body, queryParams: params ? Object.fromEntries(entries) : undefined };
}
