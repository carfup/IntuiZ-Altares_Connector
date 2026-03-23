import { logger } from '../utils/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const GetGlobalContext: (() => { getClientUrl(): string }) | undefined;
declare const Xrm: { Utility: { getGlobalContext(): { getClientUrl(): string } } } | undefined;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Resolve the D365 org base URL. Three fallback strategies:
 *
 * 1. GetGlobalContext() — injected by ClientGlobalContext.js.aspx (most reliable for web resources)
 * 2. parent.Xrm — web resources run in an iframe; Xrm lives on the parent window
 * 3. window.Xrm — available when opened as a standalone page in some D365 contexts
 *
 * Returns '' when running outside D365 (localhost / mock mode).
 */
export function getBaseUrl(): string {
  try {
    // 1. ClientGlobalContext.js.aspx script (included in index.html)
    if (typeof GetGlobalContext !== 'undefined') {
      return GetGlobalContext().getClientUrl();
    }
    // 2. Parent window Xrm (web resource iframe)
    const parentXrm = (window as any).parent?.Xrm;
    if (parentXrm?.Utility?.getGlobalContext) {
      return parentXrm.Utility.getGlobalContext().getClientUrl();
    }
    // 3. Current window Xrm (standalone / classic web resource)
    if (typeof Xrm !== 'undefined') {
      return Xrm.Utility.getGlobalContext().getClientUrl();
    }
  } catch (err) {
    logger.warn('Dataverse', 'Could not resolve D365 base URL — falling back to relative path', err);
  }
  return '';
}

const HEADERS: HeadersInit = {
  'OData-MaxVersion': '4.0',
  'OData-Version': '4.0',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY = 500;
const TIMEOUT_MS = 30_000;

// --- Request tracking ---

export interface RequestEntry {
  id: number;
  method: string;
  path: string;
  status: number | null;
  duration: number;
  retries: number;
  error?: string;
  timestamp: string;
}

const MAX_REQUEST_ENTRIES = 100;
let nextRequestId = 1;
const requestBuffer: RequestEntry[] = [];
const requestSubscribers = new Set<(entry: RequestEntry) => void>();

function pushRequestEntry(entry: RequestEntry): void {
  if (requestBuffer.length >= MAX_REQUEST_ENTRIES) {
    requestBuffer.shift();
  }
  requestBuffer.push(entry);
  requestSubscribers.forEach(cb => cb(entry));
}

export function getRequestLog(): RequestEntry[] {
  return [...requestBuffer];
}

export function clearRequestLog(): void {
  requestBuffer.length = 0;
}

export function subscribeToRequests(cb: (entry: RequestEntry) => void): () => void {
  requestSubscribers.add(cb);
  return () => { requestSubscribers.delete(cb); };
}

function formatTimestamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// --- Fetch with retry ---

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const startTime = performance.now();
  const method = label.split(' ')[0];
  const path = label.split(' ').slice(1).join(' ');
  let lastStatus: number | null = null;
  let retryCount = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      logger.debug('Dataverse', `${label} (attempt ${attempt}/${MAX_RETRIES})`);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      lastStatus = res.status;

      if (res.ok) {
        pushRequestEntry({
          id: nextRequestId++,
          method,
          path,
          status: res.status,
          duration: Math.round(performance.now() - startTime),
          retries: retryCount,
          timestamp: formatTimestamp(),
        });
        return res;
      }

      if (RETRYABLE_CODES.has(res.status) && attempt < MAX_RETRIES) {
        retryCount++;
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        logger.warn('Dataverse', `${label} returned ${res.status}, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      const errMsg = `${label} failed: ${res.status} ${res.statusText}`;
      pushRequestEntry({
        id: nextRequestId++,
        method,
        path,
        status: res.status,
        duration: Math.round(performance.now() - startTime),
        retries: retryCount,
        error: errMsg,
        timestamp: formatTimestamp(),
      });
      throw new Error(errMsg);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        const errMsg = `${label} timed out after ${TIMEOUT_MS / 1000}s`;
        pushRequestEntry({
          id: nextRequestId++,
          method,
          path,
          status: null,
          duration: Math.round(performance.now() - startTime),
          retries: retryCount,
          error: errMsg,
          timestamp: formatTimestamp(),
        });
        throw new Error(errMsg);
      }
      if (err instanceof Error && err.message.startsWith(label)) throw err;
      if (attempt < MAX_RETRIES) {
        retryCount++;
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        logger.warn('Dataverse', `${label} network error, retrying in ${delay}ms...`, err);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      logger.error('Dataverse', `${label} failed after ${MAX_RETRIES} attempts`, err);
      pushRequestEntry({
        id: nextRequestId++,
        method,
        path,
        status: lastStatus,
        duration: Math.round(performance.now() - startTime),
        retries: retryCount,
        error: err instanceof Error ? err.message : String(err),
        timestamp: formatTimestamp(),
      });
      throw err;
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts`);
}

export function sanitizeODataValue(value: string): string {
  return value.replace(/'/g, "''");
}

export async function dataverseGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const url = `${getBaseUrl()}/api/data/v9.2/${path}`;
  const res = await fetchWithRetry(url, { headers: HEADERS }, `GET ${path}`);
  return res.json();
}

export async function dataversePost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${getBaseUrl()}/api/data/v9.2/${path}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    },
    `POST ${path}`,
  );
  return res.json();
}

export async function dataversePatch(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const url = `${getBaseUrl()}/api/data/v9.2/${path}`;
  await fetchWithRetry(
    url,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify(body),
    },
    `PATCH ${path}`,
  );
}

export async function dataverseBatch(payload: string, contentType: string): Promise<Response> {
  const url = `${getBaseUrl()}/api/data/v9.2/$batch`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        'Content-Type': contentType,
      },
      body: payload,
    },
    'POST $batch',
  );
  return res;
}

export async function dataverseCustomAction<T = Record<string, unknown>>(
  actionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${getBaseUrl()}/api/data/v9.2/${actionName}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    },
    `POST ${actionName}`,
  );
  return res.json();
}
