import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { predictMatch, type AutomationRule } from "@/components/panel/automationRules";
import { sameId } from "@/lib/zernio";

type CommentAuthor = { isOwner?: boolean };
type InboxComment = {
  id?: string;
  message?: string;
  createdTime?: string;
  from?: CommentAuthor;
  replies?: InboxComment[];
  repliesHasMore?: boolean;
};
type CommentedPost = { id?: string; accountId?: unknown; isAd?: boolean };
type AutomationLog = {
  commentId?: string;
  source?: "comment" | "live_comment" | "story_reply" | "story_mention" | "dm" | null;
  status?: "pending" | "sent" | "failed" | "skipped" | "gated";
  privateReplyConsumed?: boolean | null;
};
type RecoveryState = { checkpoints: Record<string, string> };
type RecoveryCounts = { replies: number; dms: number };
type PagedResponse<T> = {
  data?: T[];
  comments?: T[];
  automations?: T[];
  logs?: T[];
  profiles?: T[];
  accounts?: T[];
  pagination?: {
    hasMore?: boolean;
    nextCursor?: string | null;
    cursor?: string | null;
    total?: number;
    limit?: number;
    skip?: number;
  };
  error?: string;
  message?: string;
};

class RecoveryError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "RecoveryError";
  }
}

const INITIAL_LOOKBACK_MS = 10 * 60 * 1000;
const CHECKPOINT_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 100;
const MAX_COMMENT_DEPTH = 10;
const dataDirectory = path.resolve(process.cwd(), process.env.AUTH_DATA_DIR?.trim() || ".data");
const statePath = path.join(dataDirectory, "comment-recovery.json");

let recoveryPromise: Promise<void> | undefined;

function getArray<T>(body: PagedResponse<T> | T[], ...keys: Array<keyof PagedResponse<T>>) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function getId(value: { id?: unknown; _id?: unknown }) {
  const id = typeof value._id === "string" ? value._id : value.id;
  return typeof id === "string" && id ? id : "";
}

function accountKey(profileId: string, accountId: string) {
  return `${profileId}:${accountId}`;
}

async function readState(): Promise<RecoveryState> {
  let serialized: string;
  try {
    serialized = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { checkpoints: {} };
    throw error;
  }

  let value: Partial<RecoveryState>;
  try {
    value = JSON.parse(serialized) as Partial<RecoveryState>;
  } catch {
    throw new RecoveryError("فایل وضعیت بازیابی کامنت‌ها JSON معتبر نیست.");
  }
  if (!value.checkpoints || typeof value.checkpoints !== "object" || Array.isArray(value.checkpoints) ||
    Object.values(value.checkpoints).some((timestamp) => typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)))) {
    throw new RecoveryError("فایل وضعیت بازیابی کامنت‌ها ساختار معتبری ندارد.");
  }
  return { checkpoints: value.checkpoints as Record<string, string> };
}

async function writeState(state: RecoveryState) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporaryPath, statePath);
}

async function zernioRequest<T>(endpoint: string, apiKey: string, baseUrl: string, init?: RequestInit): Promise<T> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${endpoint}`);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("[comment-recovery] درخواست به Zernio با خطای ارتباطی متوقف شد.", error);
    throw new RecoveryError("ارتباط با Zernio برقرار نشد.", true);
  }
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new RecoveryError(`Zernio پاسخ JSON معتبر نداد (${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null
      ? (body as { error?: unknown; message?: unknown }).error || (body as { message?: unknown }).message
      : undefined;
    throw new RecoveryError(
      typeof message === "string" ? message : `درخواست Zernio ناموفق بود (${response.status}).`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  return body as T;
}

async function getAllPages<T>(
  endpoint: string,
  keys: Array<keyof PagedResponse<T>>,
  apiKey: string,
  baseUrl: string,
) {
  const items: T[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${endpoint}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await zernioRequest<PagedResponse<T>>(url, apiKey, baseUrl);
    items.push(...getArray(body, ...keys));
    if (!body.pagination?.hasMore) return items;
    const nextCursor = body.pagination.nextCursor ?? body.pagination.cursor;
    if (!nextCursor || nextCursor === cursor) {
      throw new RecoveryError("صفحه‌بندی پاسخ Zernio ناقص است؛ نشانگر صفحهٔ بعد دریافت نشد.");
    }
    cursor = nextCursor;
  }
  throw new RecoveryError(`تعداد صفحه‌های نتیجه از حد مجاز (${MAX_PAGES}) بیشتر شد.`);
}

async function expandCommentThreads(
  postId: string,
  accountId: string,
  comments: InboxComment[],
  apiKey: string,
  baseUrl: string,
  depth = 0,
): Promise<InboxComment[]> {
  if (depth > MAX_COMMENT_DEPTH) {
    throw new RecoveryError(`عمق رشتهٔ کامنت‌های پست ${postId} از حد مجاز بیشتر شد.`);
  }
  const expanded: InboxComment[] = [];
  for (const comment of comments) {
    let replies = comment.replies || [];
    if (comment.repliesHasMore && comment.id) {
      const query = new URLSearchParams({ accountId, commentId: comment.id });
      const additionalReplies = await getAllPages<InboxComment>(
        `/inbox/comments/${encodeURIComponent(postId)}?${query}`,
        ["comments"],
        apiKey,
        baseUrl,
      );
      const replyIds = new Set(replies.map((reply) => reply.id).filter((id): id is string => Boolean(id)));
      replies = [
        ...replies,
        ...additionalReplies.filter((reply) => !reply.id || !replyIds.has(reply.id)),
      ];
    }
    expanded.push({ ...comment, replies });
    if (replies.length) {
      expanded.push(...await expandCommentThreads(postId, accountId, replies, apiKey, baseUrl, depth + 1));
    }
  }
  return expanded;
}

function matchesPost(rule: AutomationRule, postId: string) {
  return !rule.platformPostId || rule.platformPostId === postId;
}

async function getAutomationLogs(rule: AutomationRule, apiKey: string, baseUrl: string) {
  const ruleId = getId(rule);
  if (!ruleId) throw new RecoveryError("قانون پاسخ خودکار شناسه ندارد؛ گزارش دایرکت‌ها قابل بررسی نیست.");

  const logs: AutomationLog[] = [];
  const limit = 200;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(limit), skip: String(page * limit) });
    const body = await zernioRequest<PagedResponse<AutomationLog>>(
      `/comment-automations/${encodeURIComponent(ruleId)}/logs?${query}`,
      apiKey,
      baseUrl,
    );
    if (!Array.isArray(body.logs)) {
      throw new RecoveryError(`گزارش دایرکت‌های قانون ${ruleId} قالب معتبری ندارد.`);
    }
    logs.push(...body.logs);
    if (!body.pagination?.hasMore) return logs;
    if (body.pagination.skip !== undefined && body.pagination.skip !== page * limit) {
      throw new RecoveryError(`صفحه‌بندی گزارش دایرکت‌های قانون ${ruleId} درست پیش نرفت.`);
    }
  }
  throw new RecoveryError(`تعداد صفحه‌های گزارش دایرکت قانون ${ruleId} از حد مجاز بیشتر شد.`);
}

async function recoverAccount(
  accountId: string,
  rules: AutomationRule[],
  since: string,
  scanStartedAt: string,
  apiKey: string,
  baseUrl: string,
): Promise<RecoveryCounts> {
  const commentRules = rules.filter((rule) =>
    rule.isActive !== false &&
    (rule.trigger || "comment") === "comment" &&
    Boolean(rule.commentReply?.trim() || rule.dmMessage?.trim()),
  );
  if (!commentRules.length) return { replies: 0, dms: 0 };
  const logsByRule = new Map<string, AutomationLog[]>();
  for (const rule of commentRules.filter((candidate) => candidate.dmMessage?.trim())) {
    logsByRule.set(getId(rule), await getAutomationLogs(rule, apiKey, baseUrl));
  }

  const postsQuery = new URLSearchParams({
    accountId,
    sortBy: "date",
    sortOrder: "asc",
  });
  const posts = await getAllPages<CommentedPost>(
    `/inbox/comments?${postsQuery}`,
    ["data"],
    apiKey,
    baseUrl,
  );
  const processedCommentIds = new Set<string>();
  const visitedPostIds = new Set<string>();
  let repliesSent = 0;
  let dmsSent = 0;

  for (const post of posts) {
    const postId = getId(post);
    if (!postId || post.isAd || visitedPostIds.has(postId) || !sameId(post.accountId, accountId)) continue;
    visitedPostIds.add(postId);
    const commentsQuery = new URLSearchParams({ accountId });
    const rootComments = await getAllPages<InboxComment>(
      `/inbox/comments/${encodeURIComponent(postId)}?${commentsQuery}`,
      ["comments"],
      apiKey,
      baseUrl,
    );
    const comments = await expandCommentThreads(postId, accountId, rootComments, apiKey, baseUrl);

    for (const comment of comments) {
      const commentId = comment.id || "";
      const createdAt = comment.createdTime ? Date.parse(comment.createdTime) : NaN;
      if (!commentId || processedCommentIds.has(commentId)) continue;
      processedCommentIds.add(commentId);
      if (!Number.isFinite(createdAt) || createdAt < Date.parse(since) ||
        createdAt >= Date.parse(scanStartedAt) || comment.from?.isOwner ||
        comment.replies?.some((reply) => reply.from?.isOwner === true)) {
        continue;
      }

      const matchingRules = commentRules.filter((candidate) =>
        matchesPost(candidate, postId) &&
        predictMatch(candidate, comment.message || "").matched,
      );
      if (matchingRules.length > 1) {
        console.warn(`[comment-recovery] چند قانون با کامنت ${commentId} در حساب ${accountId} جور شد؛ فقط پاسخ عمومی قانون اول استفاده می‌شود.`);
      }
      const rule = matchingRules[0];
      if (!rule || (!rule.commentReply?.trim() && !rule.dmMessage?.trim())) continue;

      const previousDm = (logsByRule.get(getId(rule)) || []).find((log) =>
        log.commentId === commentId && log.source !== "dm",
      );
      let dmSucceeded = previousDm?.status === "sent";
      const dmAlreadyHandled = previousDm?.status === "pending" || previousDm?.status === "gated" ||
        previousDm?.status === "skipped" || previousDm?.privateReplyConsumed === true;
      if (rule.dmMessage?.trim() && !dmSucceeded && !dmAlreadyHandled) {
        try {
          await zernioRequest(
            `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`,
            apiKey,
            baseUrl,
            {
              method: "POST",
              body: JSON.stringify({ accountId, message: rule.dmMessage.trim() }),
            },
          );
          dmSucceeded = true;
          dmsSent += 1;
        } catch (error) {
          if (!(error instanceof RecoveryError) || error.retryable) throw error;
          console.error(`[comment-recovery] دایرکت کامنت ${commentId} در حساب ${accountId} ارسال نشد.`, error);
        }
      } else if (rule.dmMessage?.trim() && dmAlreadyHandled && !dmSucceeded) {
        console.warn(`[comment-recovery] برای کامنت ${commentId} قبلاً دایرکت ثبت شده یا محدودیت قانون اعمال شده؛ ارسال دوباره انجام نمی‌شود.`);
      }

      const shouldReplyPublicly = Boolean(rule.commentReply?.trim()) &&
        (rule.publicReplyPolicy === "always" || dmSucceeded);
      if (!shouldReplyPublicly) {
        continue;
      }

      const publicReply = rule.commentReply?.trim();
      const replyBody = JSON.stringify({
        accountId,
        commentId,
        message: publicReply || "",
      });
      try {
        await zernioRequest(
          `/inbox/comments/${encodeURIComponent(postId)}`,
          apiKey,
          baseUrl,
          { method: "POST", body: replyBody },
        );
        try {
          await zernioRequest(
            `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/like`,
            apiKey,
            baseUrl,
            { method: "POST", body: JSON.stringify({ accountId }) },
          );
        } catch (error) {
          console.error(`[comment-recovery] پاسخ کامنت ${commentId} رفت، اما لایک آن در حساب ${accountId} انجام نشد.`, error);
        }
        repliesSent += 1;
      } catch (error) {
        if (!(error instanceof RecoveryError) || error.retryable) throw error;
        console.error(`[comment-recovery] پاسخ عمومی کامنت ${commentId} در حساب ${accountId} ارسال نشد.`, error);
      }
    }
  }

  return { replies: repliesSent, dms: dmsSent };
}

async function enableCommentLikesForRules(rules: AutomationRule[], accountId: string, apiKey: string, baseUrl: string) {
  const commentRules = rules.filter((rule) =>
    sameId(rule.accountId, accountId) &&
    (rule.trigger || "comment") === "comment" &&
    rule.actions?.likeComment !== true,
  );
  for (const rule of commentRules) {
    const id = getId(rule);
    if (!id) {
      throw new RecoveryError(`قانون کامنت در حساب ${accountId} شناسه ندارد؛ فعال‌سازی لایک ممکن نشد.`);
    }
    await zernioRequest(
      `/comment-automations/${encodeURIComponent(id)}`,
      apiKey,
      baseUrl,
      {
        method: "PATCH",
        body: JSON.stringify({
          actions: {
            ...rule.actions,
            likeComment: true,
          },
        }),
      },
    );
    console.info(`[comment-recovery] لایک کامنت برای قانون ${id} در حساب ${accountId} فعال شد.`);
  }
}

async function runRecovery() {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    console.warn("[comment-recovery] ZERNIO_API_KEY یا ZERNIO_BASE_URL تنظیم نشده؛ بازیابی اجرا نشد.");
    return;
  }

  const state = await readState();
  const scanStartedAt = new Date().toISOString();
  const profilesBody = await zernioRequest<PagedResponse<{ id?: unknown; _id?: unknown }>>(
    "/profiles",
    apiKey,
    baseUrl,
  );
  const profiles = getArray(profilesBody, "profiles", "data");
  let recoveredReplies = 0;
  let recoveredDms = 0;
  const failedAccounts: string[] = [];
  const permanentlyFailedAccounts: string[] = [];

  for (const profile of profiles) {
    const profileId = getId(profile);
    if (!profileId) {
      console.error("[comment-recovery] یک پروفایل از پاسخ Zernio شناسه ندارد و بررسی نشد.");
      continue;
    }

    const accountsQuery = new URLSearchParams({ profileId });
    const accountsBody = await zernioRequest<PagedResponse<{ id?: unknown; _id?: unknown; platform?: unknown; isActive?: unknown }>>(
      `/accounts?${accountsQuery}`,
      apiKey,
      baseUrl,
    );
    const accounts = getArray(accountsBody, "accounts", "data");
    const rulesQuery = new URLSearchParams({ profileId });
    const rulesBody = await zernioRequest<PagedResponse<AutomationRule>>(
      `/comment-automations?${rulesQuery}`,
      apiKey,
      baseUrl,
    );
    const rules = getArray(rulesBody, "automations", "data");

    for (const account of accounts) {
      const accountId = getId(account);
      if (!accountId) {
        console.error(`[comment-recovery] یک حساب در پروفایل ${profileId} شناسه ندارد و بررسی نشد.`);
        continue;
      }
      if (account.isActive === false || (account.platform !== "instagram" && account.platform !== "facebook")) {
        continue;
      }
      const key = accountKey(profileId, accountId);
      const savedCheckpoint = state.checkpoints[key];
      const since = savedCheckpoint
        ? new Date(Date.parse(savedCheckpoint) - CHECKPOINT_OVERLAP_MS).toISOString()
        : new Date(Date.parse(scanStartedAt) - INITIAL_LOOKBACK_MS).toISOString();
      const accountRules = rules.filter((rule) => sameId(rule.accountId, accountId));

      try {
        await enableCommentLikesForRules(accountRules, accountId, apiKey, baseUrl);
        const recovered = await recoverAccount(
          accountId,
          accountRules,
          since,
          scanStartedAt,
          apiKey,
          baseUrl,
        );
        recoveredReplies += recovered.replies;
        recoveredDms += recovered.dms;
        state.checkpoints[key] = scanStartedAt;
        await writeState(state);
      } catch (error) {
        console.error(`[comment-recovery] بازیابی حساب ${accountId} ناموفق بود؛ بررسی بعدی از همان نقطه ادامه می‌یابد.`, error);
        if (error instanceof RecoveryError && !error.retryable) {
          permanentlyFailedAccounts.push(accountId);
          continue;
        }
        failedAccounts.push(accountId);
      }
    }
  }

  console.info(`[comment-recovery] بررسی کامل شد؛ ${recoveredDms} دایرکت و ${recoveredReplies} پاسخ عمومی بازیابی شد.`);
  if (permanentlyFailedAccounts.length) {
    console.error(`[comment-recovery] بررسی این حساب‌ها به خطای غیرقابل‌تلاش‌مجدد رسید: ${permanentlyFailedAccounts.join(", ")}`);
  }
  if (failedAccounts.length) {
    throw new RecoveryError(`بازیابی برای ${failedAccounts.length} حساب ناموفق بود.`, true);
  }
}

const retryDelay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function retryRecoveryUntilSuccess() {
  while (true) {
    try {
      await runRecovery();
      return;
    } catch (error) {
      console.error("[comment-recovery] بررسی کامل نشد؛ یک دقیقهٔ دیگر دوباره تلاش می‌شود.", error);
      if (error instanceof RecoveryError && !error.retryable) return;
      await retryDelay(60_000);
    }
  }
}

export function recoverMissedCommentsOnStartup() {
  if (!recoveryPromise) {
    recoveryPromise = retryRecoveryUntilSuccess();
  }
  return recoveryPromise;
}
