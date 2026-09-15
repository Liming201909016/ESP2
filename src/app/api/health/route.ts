import { NextResponse } from "next/server";
import { skillRegistry } from "@/lib/esp/registry";
import { stateBackend, stateWritesPaused } from "@/lib/esp/state-config";

export function GET() {
  return NextResponse.json({
    status: "healthy",
    ready: true,
    service: "ESP Skill Router API",
    version: "0.1.0",
    state: { backend: stateBackend(), writesPaused: stateWritesPaused() },
    registry: {
      status: "healthy",
      skillCount: skillRegistry.length,
    },
  });
}