export type BuyerType = "importer" | "distributor" | "both";

export interface Buyer {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  country: string;
  city: string | null;
  businessDescription: string | null;
  buyerType: string | null;
  email: string | null;
  phone: string | null;
  sourceUrl: string | null;
}

export interface ScrapeQueryMeta {
  query: string;
  keyword: string;
  country: string;
  countryCode: string;
  buyerType: Exclude<BuyerType, "both"> | null;
}

export interface ScrapeProgress {
  completed: number;
  total: number;
  percent: number;
  places: number;
  stage: string;
}

export type ScrapeStatus = "pending" | "running" | "completed" | "failed";

export interface ScrapeJobResponse {
  id: string;
  status: ScrapeStatus;
  error: string | null;
  progress: ScrapeProgress;
  completedQueries: number;
  totalQueries: number;
  results: Buyer[];
}

export interface SearchConfiguration {
  query: string;
  source: "google_maps";
}

export interface SearchCreatedResponse {
  id: string;
  queryCount: number;
  queries: string[];
  maxResults: number;
  status: "pending" | "running";
}
