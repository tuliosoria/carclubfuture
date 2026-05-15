/**
 * Standard API envelope: { success, data?, error? } — Day 1 (§18.3.1 prep).
 */
import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/errors";

export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: ApiError };

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(error: ApiError, status = 400): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, error }, { status });
}
