"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Copy,
  Download,
  Globe,
  Loader2,
  Mail,
  Phone,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  Buyer,
  SearchConfiguration,
  SearchCreatedResponse,
  ScrapeJobResponse,
} from "@/lib/scraper-types";

const COLUMNS: Array<{ key: keyof Buyer; label: string }> = [
  { key: "name", label: "Company Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
  { key: "businessDescription", label: "Business Description" },
  { key: "buyerType", label: "Buyer Type" },
  { key: "website", label: "Website" },
  { key: "sourceUrl", label: "Source URL" },
];

const EMPTY_RESULTS: Buyer[] = [];

type BuyerTypeFilter = "all" | "importer" | "distributor";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export default function BuyerSearchPage() {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = React.useState("");
  const [searchId, setSearchId] = React.useState<string | null>(null);

  const [hasEmail, setHasEmail] = React.useState(true);
  const [hasPhone, setHasPhone] = React.useState(false);
  const [hasWebsite, setHasWebsite] = React.useState(false);
  const [hasContact, setHasContact] = React.useState(false);
  const [buyerTypeFilter, setBuyerTypeFilter] = React.useState<BuyerTypeFilter>("all");
  const [countryFilter, setCountryFilter] = React.useState("all");
  const [copyMessage, setCopyMessage] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const copyFeedbackTimeout = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (copyFeedbackTimeout.current !== null) {
        window.clearTimeout(copyFeedbackTimeout.current);
      }
    },
    []
  );

  const queryCount = searchText.trim() ? 1 : 0;
  const formIsValid = searchText.trim().length > 0 && searchText.trim().length <= 500;

  const searchMutation = useMutation({
    mutationFn: async (configuration: SearchConfiguration) => {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration),
      });
      return readJson<SearchCreatedResponse>(response);
    },
    onSuccess: (search) => {
      setSearchId(search.id);
      setCopyMessage("");
      queryClient.setQueryData<ScrapeJobResponse>(["search", search.id], {
        id: search.id,
        status: "pending",
        error: null,
        progress: {
          completed: 0,
          total: search.queryCount,
          percent: 0,
          places: 0,
          stage: "queued",
        },
        completedQueries: 0,
        totalQueries: search.queryCount,
        results: [],
      });
    },
  });

  const searchQuery = useQuery({
    queryKey: ["search", searchId],
    queryFn: async () => {
      if (!searchId) throw new Error("Missing search ID.");
      const response = await fetch(`/api/search/${searchId}`, { cache: "no-store" });
      return readJson<ScrapeJobResponse>(response);
    },
    enabled: Boolean(searchId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 2_000 : false;
    },
    retry: 1,
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/search/${id}/cancel`, { method: "POST" });
      return readJson<ScrapeJobResponse>(response);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["search", result.id], result);
    },
  });

  const search = searchQuery.data;
  const results = search?.results ?? EMPTY_RESULTS;
  const isSearching =
    searchMutation.isPending ||
    cancelMutation.isPending ||
    search?.status === "pending" ||
    search?.status === "running";
  const errorMessage =
    searchMutation.error?.message ??
    searchQuery.error?.message ??
    cancelMutation.error?.message ??
    (search?.status === "failed" ? search.error : null);

  const countriesInResults = React.useMemo(
    () => [...new Set(results.map((result) => result.country).filter(Boolean))].sort(),
    [results]
  );
  const filteredResults = React.useMemo(
    () =>
      results.filter((result) => {
        if (hasEmail && !result.email) return false;
        if (hasPhone && !result.phone) return false;
        if (hasWebsite && !result.website) return false;
        if (hasContact && !result.email && !result.phone) return false;
        if (
          buyerTypeFilter !== "all" &&
          (result.buyerType ?? "").toLowerCase() !== buyerTypeFilter
        ) {
          return false;
        }
        if (countryFilter !== "all" && result.country !== countryFilter) return false;
        return true;
      }),
    [results, hasEmail, hasPhone, hasWebsite, hasContact, buyerTypeFilter, countryFilter]
  );

  const onSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formIsValid || isSearching) return;
    searchMutation.mutate({
      query: searchText.trim().replace(/\s+/g, " "),
      source: "google_maps",
    });
  };

  const downloadCsv = () => {
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const content = [
      COLUMNS.map((column) => escapeCsv(column.label)).join(","),
      ...filteredResults.map((result) =>
        COLUMNS.map((column) => escapeCsv(result[column.key])).join(",")
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `buyer-search-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const copyTable = async () => {
    const content = [
      COLUMNS.map((column) => column.label).join("\t"),
      ...filteredResults.map((result) =>
        COLUMNS.map((column) =>
          String(result[column.key] ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ")
        ).join("\t")
      ),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setCopyMessage(`Copied ${filteredResults.length} filtered rows.`);
      setCopied(true);
      if (copyFeedbackTimeout.current !== null) {
        window.clearTimeout(copyFeedbackTimeout.current);
      }
      copyFeedbackTimeout.current = window.setTimeout(() => setCopied(false), 1_800);
    } catch (error) {
      setCopied(false);
      setCopyMessage(
        error instanceof Error
          ? `Could not copy to clipboard: ${error.message}`
          : "Could not copy to clipboard. Check browser clipboard permissions."
      );
    }
  };

  const renderCell = (result: Buyer, key: keyof Buyer) => {
    const value = result[key];
    if (key === "website" || key === "sourceUrl") {
      if (!value) return <span className="text-muted-foreground">—</span>;
      const href =
        key === "website" && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline underline-offset-2 hover:opacity-80"
          title={value}
        >
          {key === "website" ? result.domain || value : value}
        </a>
      );
    }
    if (!value) return <span className="text-muted-foreground">—</span>;
    if (key === "buyerType") return <Badge variant="outline">{value}</Badge>;
    return <span className={key === "name" ? "font-medium" : undefined}>{value}</span>;
  };

  const progress = search?.progress;
  const progressPercent = Math.min(100, Math.max(0, progress?.percent ?? 0));
  const statusText = search?.status === "pending" ? "Waiting for scraper…" : progress?.stage;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Search className="size-5" />
          </span>
          Buyer Search Tool
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Find importers and distributors using the existing local Google Maps scraper.
          Search jobs and results are held in memory and disappear when this app restarts.
        </p>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <X className="mt-0.5 size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Search for buyers</CardTitle>
          <CardDescription>
            Describe what you are looking for in one search. The local Google Maps scraper uses your
            query as written.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="search-query" className="sr-only">
              Search products, companies, and locations
            </label>
            <Input
              id="search-query"
              type="search"
              maxLength={500}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="e.g. plastic manufacturer list in Nepal"
              className="h-11 flex-1 text-base"
            />
            <Button
                type="submit"
                disabled={!formIsValid || isSearching}
                className="h-11 sm:min-w-44"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search className="size-4" />
                    Search Buyers
                  </>
                )}
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            {queryCount ? "1 search query" : "Enter a search phrase to begin"} · Searching with the
            existing local Google Maps source
          </p>
        </CardContent>
      </Card>

      {(isSearching || search) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Search progress</CardTitle>
                <CardDescription>{statusText || "Scraper status"}</CardDescription>
              </div>
              {isSearching && searchId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(searchId)}
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Cancel
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {search?.completedQueries ?? 0} of {search?.totalQueries ?? queryCount} queries complete
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{progress?.places ?? results.length} discovered places</span>
              <span>{results.length} unique companies</span>
              {search?.status === "completed" && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Check className="size-3.5" /> Complete
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Buyer results</CardTitle>
              <CardDescription className="mt-1">
                {results.length} total results · {filteredResults.length} filtered
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!filteredResults.length}
                onClick={downloadCsv}
              >
                <Download className="size-4" />
                Download CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!filteredResults.length}
                onClick={copyTable}
                className={
                  copied
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                    : undefined
                }
              >
                {copied ? (
                  <>
                    <Check className="size-4 animate-copy-pop" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    Copy Table
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={hasEmail ? "default" : "outline"}
              aria-pressed={hasEmail}
              onClick={() => setHasEmail((active) => !active)}
            >
              <Mail className="size-4" />
              Has Email
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hasPhone ? "default" : "outline"}
              aria-pressed={hasPhone}
              onClick={() => setHasPhone((active) => !active)}
            >
              <Phone className="size-4" />
              Has Phone
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hasWebsite ? "default" : "outline"}
              aria-pressed={hasWebsite}
              onClick={() => setHasWebsite((active) => !active)}
            >
              <Globe className="size-4" />
              Has Website
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hasContact ? "default" : "outline"}
              aria-pressed={hasContact}
              onClick={() => setHasContact((active) => !active)}
            >
              <Building2 className="size-4" />
              Has Contact Information
            </Button>
            <Select
              options={[
                { value: "all", label: "All buyer types" },
                { value: "importer", label: "Importers" },
                { value: "distributor", label: "Distributors" },
              ]}
              value={buyerTypeFilter}
              onValueChange={(value) => setBuyerTypeFilter(value as BuyerTypeFilter)}
              className="w-44"
            />
            <Select
              options={[
                { value: "all", label: "All countries" },
                ...countriesInResults.map((country) => ({ value: country, label: country })),
              ]}
              value={countryFilter}
              onValueChange={setCountryFilter}
              className="w-48"
            />
          </div>

          {copyMessage && (
            <p role="status" className="text-sm text-muted-foreground">
              {copyMessage}
            </p>
          )}

          <Separator />

          {searchQuery.isLoading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading scraper results…
            </div>
          ) : !filteredResults.length ? (
            <EmptyState
              title={
                isSearching
                  ? "Waiting for the first results"
                  : results.length
                    ? "No buyers match these filters"
                    : search?.status === "completed"
                      ? "No buyers found"
                      : "No results yet"
              }
              description={
                isSearching
                  ? "New results will appear here as the local scraper finishes each query."
                  : results.length
                    ? "Adjust or clear the client-side filters to see more results."
                    : search?.status === "completed"
                      ? "Try other keywords or countries. The scraper did not return any companies for this search."
                      : "Enter a search phrase above, then start a search."
              }
              className="min-h-48"
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((column) => (
                      <TableHead key={column.key} className="min-w-32">
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.map((result) => (
                    <TableRow key={result.id}>
                      {COLUMNS.map((column) => (
                        <TableCell key={column.key} className="max-w-72 align-top">
                          {renderCell(result, column.key)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
