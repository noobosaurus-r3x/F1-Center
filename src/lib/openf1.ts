export type Primitive = string | number | boolean | null | undefined;
export type QueryValue = Primitive | Primitive[];
export type FilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface FilterClause {
  field: string;
  operator: FilterOperator;
  value: string;
}

const BASE_URL = 'https://api.openf1.org/v1';
const REQUEST_SPACING_MS = 380;

let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const responseCache = new Map<string, Promise<unknown>>();

const isMeaningful = (value: Primitive) =>
  value !== undefined && value !== null && String(value).trim().length > 0;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const localizeApiMessage = (message: string) => {
  switch (message) {
    case 'No results found.':
      return 'Aucun résultat.';
    case 'Rate limit exceeded. Max 3 requests/second.':
      return 'Limite publique atteinte: maximum 3 requêtes par seconde.';
    case 'Too Many Requests':
      return 'Trop de requêtes.';
    case 'Not Found':
      return 'Ressource introuvable.';
    default:
      return message;
  }
};

export const splitMultiValue = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const appendEntry = (search: URLSearchParams, key: string, value: Primitive) => {
  if (!isMeaningful(value)) {
    return;
  }

  search.append(key, String(value));
};

export const buildEndpointUrl = (
  path: string,
  params: Record<string, QueryValue> = {},
  filters: FilterClause[] = [],
  csv = false,
) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, rawValue]) => {
    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => appendEntry(search, key, value));
      return;
    }

    appendEntry(search, key, rawValue);
  });

  filters.forEach((filter) => {
    if (!filter.field.trim() || !filter.value.trim()) {
      return;
    }

    const queryKey = filter.operator === '=' ? filter.field : `${filter.field}${filter.operator}`;
    splitMultiValue(filter.value).forEach((value) => appendEntry(search, queryKey, value));
  });

  if (csv) {
    search.set('csv', 'true');
  }

  const query = search.toString();
  return `${BASE_URL}/${path}${query ? `?${query}` : ''}`;
};

const scheduleRequest = async <T>(task: () => Promise<T>) => {
  const queuedTask = requestQueue.then(async () => {
    const waitTime = Math.max(0, REQUEST_SPACING_MS - (Date.now() - lastRequestAt));
    if (waitTime > 0) {
      await sleep(waitTime);
    }

    lastRequestAt = Date.now();
    return task();
  });

  requestQueue = queuedTask.catch(() => undefined);
  return queuedTask;
};

interface FetchOpenF1Options {
  force?: boolean;
}

export async function fetchOpenF1<T extends Record<string, unknown>>(
  url: string,
  options: FetchOpenF1Options = {},
): Promise<T[]> {
  if (options.force) {
    responseCache.delete(url);
  }

  if (responseCache.has(url)) {
    return responseCache.get(url) as Promise<T[]>;
  }

  const request = scheduleRequest(async () => {
    const response = await fetch(url);
    const text = await response.text();
    let payload: unknown = [];

    try {
      payload = text ? JSON.parse(text) : [];
    } catch {
      throw new Error(`Format de réponse OpenF1 inattendu pour ${url}`);
    }

    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload !== null && 'detail' in payload
          ? String((payload as { detail: unknown }).detail)
          : response.statusText;
      throw new Error(localizeApiMessage(detail || `Échec OpenF1 (${response.status})`));
    }

    if (typeof payload === 'object' && payload !== null && 'detail' in payload) {
      const detail = String((payload as { detail: unknown }).detail);
      if (detail === 'No results found.') {
        return [] as T[];
      }
    }

    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      throw new Error(localizeApiMessage(String((payload as { error: unknown }).error)));
    }

    if (!Array.isArray(payload)) {
      return [] as T[];
    }

    return payload as T[];
  });

  responseCache.set(url, request);
  return request as Promise<T[]>;
}
