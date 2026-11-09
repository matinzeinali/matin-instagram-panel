import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local store for the "second public reply to commenters who never confirmed the follow gate" feature.
 * Zernio has no field for it, so the settings (per rule) and the already-handled automation logs live in .data/followups.json.
 */
export type FollowupSetting = { enabled: boolean; delayMinutes: number; replies: string[] };
type FollowupStore = { settings: Record<string, FollowupSetting>; handled: Record<string, string> };

export const MIN_DELAY_MINUTES = 5;
export const MAX_DELAY_MINUTES = 3 * 24 * 60;
export const MAX_FOLLOWUP_REPLIES = 5;
export const DEFAULT_FOLLOWUP_SETTING: FollowupSetting = {
  enabled: false,
  delayMinutes: 30,
  replies: ["اگر پیام برات نیومد، همین کلمه رو توی دایرکت برام بفرست تا دوباره بفرستمش 🙏"],
};

const dataDirectory = path.resolve(process.cwd(), process.env.AUTH_DATA_DIR?.trim() || ".data");
const storePath = path.join(dataDirectory, "followups.json");
const HANDLED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

let queue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<FollowupStore> {
  try {
    const value = JSON.parse(await readFile(storePath, "utf8")) as Partial<FollowupStore>;
    return {
      settings: value.settings && typeof value.settings === "object" ? value.settings : {},
      handled: value.handled && typeof value.handled === "object" ? value.handled : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { settings: {}, handled: {} };
    throw error;
  }
}

async function writeStore(store: FollowupStore) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

/** Serialise read-modify-write cycles so the API route and the background worker never overwrite each other. */
function update<T>(change: (store: FollowupStore) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await change(store);
    await writeStore(store);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function getFollowupSetting(ruleId: string): Promise<FollowupSetting | null> {
  const store = await readStore();
  return store.settings[ruleId] ?? null;
}

export async function getEnabledFollowups() {
  const store = await readStore();
  return {
    settings: Object.entries(store.settings).filter(([, setting]) => setting.enabled && setting.replies.length),
    handled: store.handled,
  };
}

export function saveFollowupSetting(ruleId: string, setting: FollowupSetting) {
  return update((store) => { store.settings[ruleId] = setting; });
}

export function markFollowupHandled(logIds: string[]) {
  if (!logIds.length) return Promise.resolve();
  return update((store) => {
    const now = new Date().toISOString();
    for (const id of logIds) store.handled[id] = now;
    const cutoff = Date.now() - HANDLED_RETENTION_MS;
    for (const [id, at] of Object.entries(store.handled)) if (Date.parse(at) < cutoff) delete store.handled[id];
  });
}

/** Validate and normalise what the panel sends; returns an error sentence in Persian when it is not acceptable. */
export function normaliseFollowupSetting(input: unknown): { setting?: FollowupSetting; error?: string } {
  const value = (input && typeof input === "object" ? input : {}) as Partial<FollowupSetting>;
  const replies = Array.isArray(value.replies)
    ? value.replies.filter((reply): reply is string => typeof reply === "string").map((reply) => reply.trim()).filter(Boolean)
    : [];
  const delay = Math.round(Number(value.delayMinutes));
  const enabled = value.enabled === true;
  if (replies.length > MAX_FOLLOWUP_REPLIES) return { error: `حداکثر ${MAX_FOLLOWUP_REPLIES} جواب دوم می‌شود.` };
  if (replies.some((reply) => reply.length > 2200)) return { error: "هر جواب حداکثر ۲۲۰۰ نویسه می‌تواند باشد." };
  if (enabled && !replies.length) return { error: "برای جواب دوم حداقل یک متن لازم است." };
  if (enabled && !(delay >= MIN_DELAY_MINUTES && delay <= MAX_DELAY_MINUTES)) {
    return { error: `تأخیر باید بین ${MIN_DELAY_MINUTES} دقیقه و ۳ روز باشد.` };
  }
  return { setting: { enabled, delayMinutes: Number.isFinite(delay) ? Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, delay)) : DEFAULT_FOLLOWUP_SETTING.delayMinutes, replies } };
}
