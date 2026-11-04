import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { COUNTRY_BY_CODE, COUNTRIES } from "./countries";
import type {
  Buyer,
  BuyerType,
  SearchConfiguration,
  SearchCreatedResponse,
  ScrapeJobResponse,
  ScrapeQueryMeta,
  ScrapeStatus,
} from "./scraper-types";

const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const SCRAPER_DIR =
  process.env.SCRAPER_DIR ||
  path.resolve(process.cwd(), "../external-tools/google-maps-scraper-kit");
const ENGINE_TIMEOUT_MS = 20_000;
const ENGINE_START_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RESULTS = 50;

interface EngineRow {
  input_id?: string;
  link?: string;
  title?: string;
  category?: string;
  categories?: string;
  address?: string;
  website?: string;
  phone?: string;
  emails?: string;
  descriptions?: string;
  complete_address?: string;
  place_id?: string;
  data_id?: string;
  cid?: string;
  [key: string]: string | undefined;
}

interface EngineJob {
  ID: string;
  Name: string;
  Status: string;
  Data?: { keywords?: string[] };
  Error?: string;
  Progress?: {
    keywords_done?: number;
    keywords_total?: number;
    places?: number;
    percent?: number;
    stage?: string;
  };
}

interface JobMeta {
  queries: ScrapeQueryMeta[];
  maxResults: number;
  createdAt: number;
  requestKey: string;
  cancelled?: boolean;
}

type GlobalWithScrapeJobs = typeof globalThis & {
  __buyerScrapeJobs?: Map<string, JobMeta>;
  __buyerScrapeJobResponses?: Map<string, ScrapeJobResponse>;
  __buyerScrapeLaunch?: { requestKey: string; promise: Promise<SearchCreatedResponse> };
};

const globalState = globalThis as GlobalWithScrapeJobs;
const jobStore = (globalState.__buyerScrapeJobs ??= new Map<string, JobMeta>());
const responseStore = (globalState.__buyerScrapeJobResponses ??= new Map<string, ScrapeJobResponse>());

function engineHeaders() {
  const headers: Record<string, string> = {};
  if (process.env.SCRAPER_API_KEY) headers["X-API-Key"] = process.env.SCRAPER_API_KEY;
  return headers;
}

async function engineRequest(pathname: string, init?: RequestInit) {
  return fetch(`${ENGINE_URL}${pathname}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...engineHeaders(),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
  });
}

async function engineIsUp() {
  try {
    const response = await fetch(`${ENGINE_URL}/api/v1/jobs`, {
      cache: "no-store",
      headers: engineHeaders(),
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let engineStartPromise: Promise<void> | null = null;

export async function ensureEngine() {
  if (await engineIsUp()) return;
  if (engineStartPromise) return engineStartPromise;

  engineStartPromise = (async () => {
    const script = path.join(SCRAPER_DIR, "scripts", "engine.py");
    if (!existsSync(script)) {
      throw new Error(
        `Local scraper not found at ${SCRAPER_DIR}. Set SCRAPER_DIR to the google-maps-scraper-kit folder.`
      );
    }

    const python = process.env.SCRAPER_PYTHON || "python3";
    const child = spawn(/* turbopackIgnore: true */ python, [script, "start"], {
      cwd: SCRAPER_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const appendTail = (current: string, chunk: Buffer) =>
      `${current}${chunk.toString("utf8")}`.slice(-4_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendTail(stderr, chunk);
    });
    let launchError: string | null = null;
    child.on("error", (error) => {
      launchError = `Could not launch the local scraper using ${python}: ${error.message}`;
    });
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        launchError = [
          `The local scraper process exited before becoming ready (${signal ? `signal ${signal}` : `code ${code}`}).`,
          stderr.trim(),
          stdout.trim(),
        ]
          .filter(Boolean)
          .join("\n");
      }
    });
    child.unref();

    const deadline = Date.now() + ENGINE_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (await engineIsUp()) return;
      if (launchError) throw new Error(launchError);
    }

    throw new Error(
      [
        "The local scraper engine did not start within 45 seconds. Start it manually with `python3 scripts/engine.py start` in external-tools/google-maps-scraper-kit.",
        stderr.trim(),
        stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  })();

  try {
    await engineStartPromise;
  } finally {
    engineStartPromise = null;
  }
}

async function engineError(response: Response) {
  try {
    const data = (await response.json()) as { message?: string; error?: string };
    return data.message || data.error || `Scraper error (${response.status})`;
  } catch {
    return `Scraper error (${response.status})`;
  }
}

function normalizeKeyword(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function buildQueries(rawQuery: string): ScrapeQueryMeta[] {
  const query = normalizeKeyword(rawQuery);
  if (!query) throw new Error("Enter a search query.");

  const lower = query.toLowerCase();
  const country = [...COUNTRIES]
    .sort((left, right) => right.name.length - left.name.length)
    .find((candidate) => {
      const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^\\p{L}])${escapedName}($|[^\\p{L}])`, "iu").test(query);
    });

  const buyerType = /\bimporters?\b/i.test(lower)
    ? "importer"
    : /\bdistributors?\b/i.test(lower)
      ? "distributor"
      : null;

  return [
    {
      query,
      keyword: query,
      country: country?.name ?? "",
      countryCode: country?.code ?? "",
      buyerType,
    },
  ];
}

function activeResponse(status: ScrapeStatus) {
  return status === "pending" || status === "running";
}

function requestKey(input: SearchConfiguration) {
  return JSON.stringify({
    query: normalizeKeyword(input.query),
    source: input.source,
  });
}

export async function createScrapeJob(input: SearchConfiguration): Promise<SearchCreatedResponse> {
  const key = requestKey(input);
  const launch = globalState.__buyerScrapeLaunch;
  if (launch) {
    if (launch.requestKey === key) return launch.promise;
    throw new Error("A buyer search is already starting. Wait for it to finish before starting another.");
  }

  for (const [id, meta] of jobStore) {
    const current = responseStore.get(id);
    if (!meta.cancelled && current && activeResponse(current.status)) {
      if (meta.requestKey === key) {
        return {
          id,
          queryCount: current.totalQueries,
          queries: meta.queries.map((query) => query.query),
          maxResults: meta.maxResults,
          status: current.status,
        };
      }
      throw new Error("A buyer search is already running. Wait for it to finish before starting another.");
    }
  }

  const promise = startScrapeJob(input, key);
  globalState.__buyerScrapeLaunch = { requestKey: key, promise };
  try {
    return await promise;
  } finally {
    if (globalState.__buyerScrapeLaunch?.promise === promise) {
      delete globalState.__buyerScrapeLaunch;
    }
  }
}

async function startScrapeJob(
  input: SearchConfiguration,
  key: string
): Promise<SearchCreatedResponse> {
  const queries = buildQueries(input.query);
  const maxResults = DEFAULT_MAX_RESULTS;
  const depth = Math.min(10, Math.max(1, Math.ceil(maxResults / 20)));
  const maxTime = 120;
  const name = `Buyer search · ${queries[0].query.slice(0, 160)}`;

  await ensureEngine();

  const body = {
    name,
    keywords: queries.map((query) => query.query),
    lang: "en",
    country: "",
    lat: "",
    lon: "",
    zoom: 15,
    radius: 10_000,
    depth,
    max_time: maxTime,
    fast_mode: false,
    email: true,
    verify_emails: false,
    socials: false,
    browser_sites: false,
    reviews_max: 0,
    proxies: [],
  };

  let response: Response;
  try {
    response = await engineRequest("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Could not submit the search to the local scraper at ${ENGINE_URL}: ${detail}`);
  }

  if (!response.ok) throw new Error(await engineError(response));

  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("The scraper did not return a job id.");

  jobStore.set(data.id, { queries, maxResults, createdAt: Date.now(), requestKey: key });
  responseStore.set(data.id, {
    id: data.id,
    status: "pending",
    error: null,
    progress: {
      completed: 0,
      total: queries.length,
      percent: 0,
      places: 0,
      stage: "queued",
    },
    completedQueries: 0,
    totalQueries: queries.length,
    results: [],
  });
  pruneJobStore();

  return {
    id: data.id,
    queryCount: queries.length,
    queries: queries.map((query) => query.query),
    maxResults,
    status: "pending",
  };
}

function pruneJobStore() {
  const cutoff = Date.now() - 12 * 60 * 60 * 1_000;
  for (const [id, meta] of jobStore) {
    const response = responseStore.get(id);
    if (meta.createdAt < cutoff && (!response || !activeResponse(response.status))) {
      jobStore.delete(id);
      responseStore.delete(id);
    }
  }
}

function parseJsonObject(value?: string) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDomain(website?: string) {
  const raw = text(website);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryText(row: EngineRow) {
  const raw = text(row.categories) || text(row.category);
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function inferBuyerType(
  row: EngineRow,
  fallback: Exclude<BuyerType, "both"> | null
): string | null {
  const haystack = [row.title, row.category, row.categories, row.descriptions]
    .map((value) => text(value).toLowerCase())
    .join(" ");

  if (/\bimporter/.test(haystack)) return "Importer";
  if (/\bdistributor/.test(haystack)) return "Distributor";
  if (fallback === "importer") return "Importer";
  if (fallback === "distributor") return "Distributor";
  return null;
}

function parseEmails(value?: string) {
  return unique(
    text(value)
      .split(/[,;]+/)
      .map((email) => email.trim())
      .filter(Boolean)
  );
}

function mapRow(row: EngineRow, meta: ScrapeQueryMeta, index: number): Buyer | null {
  const complete = parseJsonObject(row.complete_address);
  const name = text(row.title);
  if (!name) return null;
  const website = text(row.website) || null;
  const domain = normalizeDomain(website ?? undefined);
  const addressCountry = text(complete.country);
  const country =
    (addressCountry.length === 2 ? COUNTRY_BY_CODE.get(addressCountry.toUpperCase())?.name : "") ||
    (addressCountry.length > 2 ? addressCountry : "") ||
    meta.country;
  const city = text(complete.city) || text(complete.town) || text(complete.village) || null;
  const description = text(row.descriptions) || categoryText(row) || null;
  const id =
    text(row.place_id) ||
    text(row.data_id) ||
    text(row.cid) ||
    `${normalizeName(name)}-${domain ?? index}`;

  return {
    id,
    name,
    website,
    domain,
    country,
    city,
    businessDescription: description,
    buyerType: inferBuyerType(row, meta.buyerType),
    email: parseEmails(row.emails).join(", ") || null,
    phone: text(row.phone) || null,
    sourceUrl: text(row.link) || null,
  };
}

function mergeEmails(left: string | null, right: string | null) {
  const emails = unique([...(left ? parseEmails(left) : []), ...(right ? parseEmails(right) : [])]);
  return emails.join(", ") || null;
}

function mergeBuyers(left: Buyer, right: Buyer): Buyer {
  return {
    id: left.id,
    name: left.name,
    website: left.website || right.website,
    domain: left.domain || right.domain,
    country: left.country || right.country,
    city: left.city || right.city,
    businessDescription: left.businessDescription || right.businessDescription,
    buyerType: left.buyerType || right.buyerType,
    email: mergeEmails(left.email, right.email),
    phone: left.phone || right.phone,
    sourceUrl: left.sourceUrl || right.sourceUrl,
  };
}

function mapRows(rows: EngineRow[], meta: JobMeta) {
  const queryMeta = new Map(meta.queries.map((query) => [query.query, query]));
  const perQueryCount = new Map<string, number>();
  const deduped = new Map<string, Buyer>();

  rows.forEach((row, index) => {
    const query = text(row.input_id);
    const count = perQueryCount.get(query) ?? 0;
    if (count >= meta.maxResults) return;
    perQueryCount.set(query, count + 1);

    const rowMeta = queryMeta.get(query) ?? buildQueries(query)[0];
    const buyer = mapRow(row, rowMeta, index);
    if (!buyer) return;
    const key = buyer.domain
      ? `domain:${buyer.domain}`
      : buyer.name
        ? `name:${normalizeName(buyer.name)}`
        : `id:${buyer.id}`;

    const existing = deduped.get(key);
    deduped.set(key, existing ? mergeBuyers(existing, buyer) : buyer);
  });

  return Array.from(deduped.values());
}

function statusFromEngine(status: string): ScrapeStatus {
  if (status === "ok") return "completed";
  if (status === "failed") return "failed";
  if (status === "pending") return "pending";
  return "running";
}

export async function getScrapeJob(id: string): Promise<ScrapeJobResponse> {
  const meta = jobStore.get(id);
  if (!meta) {
    throw new Error(
      "Search job not found in this app session. In-memory search history is lost when the app restarts."
    );
  }
  if (meta.cancelled) {
    const cancelledResponse = responseStore.get(id);
    if (cancelledResponse) return cancelledResponse;
  }

  await ensureEngine();

  let response: Response;
  try {
    response = await engineRequest(`/api/v1/jobs/${id}`);
  } catch {
    await ensureEngine();
    response = await engineRequest(`/api/v1/jobs/${id}`);
  }

  if (response.status === 404) throw new Error("Search job not found. Start a new search.");
  if (!response.ok) throw new Error(await engineError(response));

  const job = (await response.json()) as EngineJob;

  let rows: EngineRow[] = [];
  const download = await engineRequest(`/api/v1/jobs/${id}/download?format=json`);
  if (download.ok) {
    let data: unknown;
    try {
      data = await download.json();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`The local scraper returned unreadable result data: ${detail}`);
    }
    if (
      !Array.isArray(data) ||
      !data.every(
        (row): row is EngineRow =>
          typeof row === "object" &&
          row !== null &&
          !Array.isArray(row) &&
          Object.values(row).every((value) => typeof value === "string")
      )
    ) {
      throw new Error("The local scraper returned results in an unexpected format.");
    }
    rows = data;
  } else if (download.status !== 404) {
    throw new Error(await engineError(download));
  }

  const status = statusFromEngine(job.Status);
  const progress = job.Progress ?? {};

  const result: ScrapeJobResponse = {
    id,
    status,
    error: status === "failed" ? job.Error || "Search failed" : null,
    progress: {
      completed: Number(progress.keywords_done ?? 0),
      total: Number(progress.keywords_total ?? meta.queries.length),
      percent: Number(progress.percent ?? 0),
      places: Number(progress.places ?? rows.length),
      stage: text(progress.stage),
    },
    completedQueries: Number(progress.keywords_done ?? 0),
    totalQueries: Number(progress.keywords_total ?? meta.queries.length),
    results: mapRows(rows, meta),
  };
  responseStore.set(id, result);
  return result;
}

export async function cancelScrapeJob(id: string): Promise<ScrapeJobResponse> {
  const meta = jobStore.get(id);
  if (!meta) {
    throw new Error(
      "Search job not found in this app session. In-memory search history is lost when the app restarts."
    );
  }

  const cached = responseStore.get(id);
  if (meta.cancelled && cached) return cached;

  const current = await getScrapeJob(id);
  if (!activeResponse(current.status)) return current;

  await ensureEngine();
  const response = await engineRequest(`/api/v1/jobs/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(await engineError(response));
  }

  const cancelled: ScrapeJobResponse = {
    ...(current ?? {
      id,
      progress: {
        completed: 0,
        total: meta.queries.length,
        percent: 0,
        places: 0,
        stage: "cancelled",
      },
      completedQueries: 0,
      totalQueries: meta.queries.length,
      results: [],
    }),
    status: "failed",
    error: "Search cancelled by user.",
  };
  meta.cancelled = true;
  responseStore.set(id, cancelled);
  return cancelled;
}
