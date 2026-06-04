import type { GoogleCalendarInfo } from "@/lib/types";

/**
 * Google Calendar API ラッパ（fetchベース）。
 * accessToken は呼び出し側で（リフレッシュトークンから）用意して渡す。
 */

const BASE = "https://www.googleapis.com/calendar/v3";

export async function listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
  const res = await fetch(`${BASE}/users/me/calendarList?minAccessRole=reader`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`calendarList failed: ${res.status}`);
  const json = await res.json();
  return (json.items ?? []).map((c: any) => ({
    id: c.id,
    summary: c.summaryOverride ?? c.summary,
    primary: Boolean(c.primary),
    accessRole: c.accessRole,
    backgroundColor: c.backgroundColor,
  }));
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
  timeZone?: string;
  /** 重複防止/自己修復のための識別子 */
  privateProps?: Record<string, string>;
}

function toEventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startISO, timeZone: input.timeZone ?? "Asia/Tokyo" },
    end: { dateTime: input.endISO, timeZone: input.timeZone ?? "Asia/Tokyo" },
    extendedProperties: input.privateProps ? { private: input.privateProps } : undefined,
  };
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toEventBody(input)),
  });
  if (!res.ok) throw new Error(`insertEvent failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: json.id };
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<void> {
  const res = await fetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toEventBody(input)),
    },
  );
  if (!res.ok) throw new Error(`patchEvent failed: ${res.status} ${await res.text()}`);
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 404(既に削除済み)は成功扱い
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent failed: ${res.status}`);
  }
}
