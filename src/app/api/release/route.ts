import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { releaseMarkerSchema } from "../../../../scripts/release-contract.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const marker = releaseMarkerSchema.parse(JSON.parse(await readFile(join(process.cwd(), "public/esp-release.json"), "utf8")));
    const buildId = (await readFile(join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
    if (marker.buildId !== buildId) return NextResponse.json({ error: "RELEASE_BUILD_MISMATCH" }, { status: 503, headers });
    return NextResponse.json(marker, { headers });
  } catch (error) {
    const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    return NextResponse.json({ error: missing ? "RELEASE_UNTRACKED" : "RELEASE_METADATA_INVALID" }, { status: missing ? 404 : 503, headers });
  }
}