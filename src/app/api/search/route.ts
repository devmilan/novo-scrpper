import { NextResponse } from "next/server";

import { createScrapeJob } from "@/lib/scraper";
import { searchConfigurationSchema } from "@/lib/search-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = searchConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid search configuration.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const search = await createScrapeJob({
      ...parsed.data,
    });
    return NextResponse.json(search, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the local scraper.";
    const status = /already starting|already running/i.test(message)
      ? 409
      : /enter a search query/i.test(message)
        ? 400
        : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
