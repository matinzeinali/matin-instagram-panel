import "server-only";

import type { AutomationRule } from "@/components/panel/automationRules";
import { RecoveryError, getArray, getId, zernioRequest } from "@/lib/comment-recovery";
import { getEnabledFollowups, markFollowupHandled } from "@/lib/followup-store";
import { sameId } from "@/lib/zernio";

/**
 * Second public reply for commenters who got the follow-gate DM but never tapped the button.
 * Instagram allows only one private message per comment until the person answers, so a second DM is impossible;
 * a public reply under their comment is allowed at any time. Runs in the background while the panel server is up.
 */
type GateLog = { id?: string; commentId?: string; status?: string; audienceOutcome?: string | null; gateResolvedAt?: string | null; createdAt?: string };

const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const INTERVAL_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const SEND_GAP_MS = 60 * 1000; // at most one public reply per minute, so a backlog never looks like spam
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runTick() {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return;

  const { settings, handled } = await getEnabledFollowups();
  if (!settings.length) return; // nothing configured: make no Zernio requests at all

  const profilesBody = await zernioRequest<{ profiles?: Array<{ id?: unknown; _id?: unknown }>; data?: Array<{ id?: unknown; _id?: unknown }> }>("/profiles", apiKey, baseUrl);
  const rules: AutomationRule[] = [];
  for (const profile of getArray(profilesBody, "profiles", "data")) {
    const profileId = getId(profile);
    if (!profileId) continue;
    const body = await zernioRequest<{ automations?: AutomationRule[]; data?: AutomationRule[] }>(`/comment-automations?${new URLSearchParams({ profileId })}`, apiKey, baseUrl);
    rules.push(...getArray(body, "automations", "data"));
  }

  const now = Date.now();
  for (const [ruleId, setting] of settings) {
    const rule = rules.find((item) => getId(item) === ruleId);
    // Only rules bound to one post: the reply endpoint needs the post id, which automation logs do not carry.
    if (!rule || rule.isActive === false || (rule.trigger || "comment") !== "comment" || !rule.platformPostId || !rule.accountId) continue;
    const accountId = typeof rule.accountId === "string" ? rule.accountId : getId(rule.accountId as { id?: unknown; _id?: unknown });
    if (!accountId || !sameId(rule.accountId, accountId)) continue;

    const logsBody = await zernioRequest<{ logs?: GateLog[] }>(`/comment-automations/${encodeURIComponent(ruleId)}/logs?limit=100`, apiKey, baseUrl);
    const due = (logsBody.logs || []).filter((log) => {
      const age = log.createdAt ? now - Date.parse(log.createdAt) : NaN;
      return log.id && log.commentId && log.status === "gated" && !log.gateResolvedAt && !handled[log.id] &&
        Number.isFinite(age) && age >= setting.delayMinutes * 60_000 && age <= MAX_AGE_MS;
    });

    due.sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "")); // oldest first
    for (const log of due) {
      const message = setting.replies[Math.floor(Math.random() * setting.replies.length)];
      try {
        await zernioRequest(`/inbox/comments/${encodeURIComponent(rule.platformPostId)}`, apiKey, baseUrl, {
          method: "POST",
          body: JSON.stringify({ accountId, commentId: log.commentId, message }),
        });
        await markFollowupHandled([log.id as string]);
        console.info(`[gate-followup] جواب دوم برای کامنت ${log.commentId} (قانون ${rule.name || ruleId}) گذاشته شد.`);
        await sleep(SEND_GAP_MS);
      } catch (error) {
        if (error instanceof RecoveryError && error.retryable) throw error; // rate limit / network: try again next tick
        // Permanent failure (comment deleted, replies disabled...): do not retry forever.
        await markFollowupHandled([log.id as string]);
        console.warn(`[gate-followup] جواب دوم برای کامنت ${log.commentId} گذاشته نشد (${error instanceof Error ? error.message : String(error)}).`);
        await sleep(SEND_GAP_MS);
      }
    }
  }
}

export function startGateFollowups() {
  const holder = globalThis as { __gateFollowupStarted?: boolean };
  if (holder.__gateFollowupStarted) return; // dev server hot reloads must not start a second loop
  holder.__gateFollowupStarted = true;
  void (async () => {
    await sleep(FIRST_RUN_DELAY_MS);
    for (;;) {
      try {
        await runTick();
      } catch (error) {
        console.warn(`[gate-followup] این دور کامل نشد (${error instanceof Error ? error.message : String(error)})؛ دور بعد دوباره امتحان می‌شود.`);
      }
      await sleep(INTERVAL_MS);
    }
  })();
}
