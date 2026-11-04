import { NextResponse } from "next/server";

import { cancelScrapeJob } from "@/lib/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_ID = /^[0-9a-f-]{36}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ searchId: string }> }
) {
  const { searchId } = await params;
  if (!SEARCH_ID.test(searchId)) {
    return NextResponse.json({ error: "Invalid search ID." }, { status: 400 });
  }

  try {
    return NextResponse.json(await cancelScrapeJob(searchId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel search.";
    const status = /not found/i.test(message) ? 404 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
