"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SocialAccount } from "./types";
import { accountOptionLabel, readList, responseError, type ApiEnvelope } from "./types";
import { KeywordInput } from "./KeywordInput";
import { captionSnippet, PostPicker, PostThumb, type ActiveStory, type PlatformPost } from "./PostPicker";
import {
  collapseKeywords, expandKeywords, explainError, logStatusLabel, overlappingKeywords, parseKeywords, predictMatch,
  type AutomationRule, type MatchMode,
} from "./automationRules";

type AutomationLog = {
  id?: string; status?: string; commentText?: string | null; commenterName?: string | null; commenterUsername?: string | null;
  error?: string | null; commentReplyStatus?: string | null; commentReplyError?: string | null; privateReplyConsumed?: boolean | null; createdAt?: string;
};
type Diagnostics = { logs?: AutomationLog[]; misses?: { total?: number; retentionDays?: number; samples?: Array<{ commentText?: string; commenterName?: string; excludedBy?: string; at?: string }> }; error?: string };

type Draft = {
  name: string; trigger: "comment" | "story_reply"; keywords: string; excludeKeywords: string; matchMode: MatchMode;
  dmMessage: string; commentReply: string; repeatMode: "once" | "every_comment"; cooldownHours: string; replyAlways: boolean;
  postMode: "any" | "one"; platformPostId: string; postTitle: string;
};

const emptyDraft: Draft = { name: "", trigger: "comment", keywords: "", excludeKeywords: "", matchMode: "contains", dmMessage: "", commentReply: "", repeatMode: "every_comment", cooldownHours: "24", replyAlways: false, postMode: "any", platformPostId: "", postTitle: "" };
const DM_LIMIT = 1000;
const ruleId = (rule: AutomationRule) => rule.id || rule._id || "";
const fa = (value?: number) => (value ?? 0).toLocaleString("fa-IR");

function draftFromRule(rule: AutomationRule): Draft {
  return {
    name: rule.name || "",
    trigger: rule.trigger === "story_reply" ? "story_reply" : "comment",
    keywords: collapseKeywords(rule.keywords).join("، "),
    excludeKeywords: collapseKeywords(rule.excludeKeywords).join("، "),
    matchMode: rule.matchMode || "contains",
    dmMessage: rule.dmMessage || "",
    commentReply: rule.commentReply || "",
    repeatMode: rule.repeatPolicy?.mode || "once",
    cooldownHours: String(rule.repeatPolicy?.cooldownHours || 24),
    replyAlways: rule.publicReplyPolicy === "always",
    postMode: rule.platformPostId ? "one" : "any",
    platformPostId: rule.platformPostId || "",
    postTitle: rule.postTitle || "",
  };
}

/** Fields sent to Zernio for both create (POST) and update (PATCH). */
function payloadFromDraft(draft: Draft, actions?: AutomationRule["actions"]) {
  const cooldown = Math.min(8760, Math.max(1, Math.round(Number(draft.cooldownHours) || 24)));
  return {
    name: draft.name.trim(),
    keywords: expandKeywords(parseKeywords(draft.keywords)),
    excludeKeywords: expandKeywords(parseKeywords(draft.excludeKeywords)),
    matchMode: draft.matchMode,
    dmMessage: draft.dmMessage.trim(),
    repeatPolicy: draft.repeatMode === "once" ? { mode: "once" } : { mode: "every_comment", cooldownHours: cooldown },
    ...(draft.trigger === "comment" ? {
      commentReply: draft.commentReply.trim(),
      publicReplyPolicy: draft.replyAlways && draft.commentReply.trim() ? "always" : "after_dm",
      actions: { ...actions, likeComment: true },
    } : {}),
  };
}

/** Post/story binding for create: omitted entirely for an account-wide rule. */
function bindingForCreate(draft: Draft) {
  return draft.postMode === "one" && draft.platformPostId ? { platformPostId: draft.platformPostId, postTitle: draft.postTitle.slice(0, 120) } : {};
}

/** Post/story binding for PATCH: only sent when it changed (platformPostId, postId and postTitle move as a unit). */
function bindingForPatch(draft: Draft, rule: AutomationRule, triggerChanged: boolean) {
  const wanted = draft.postMode === "one" ? draft.platformPostId : "";
  if (!triggerChanged && wanted === (rule.platformPostId || "")) return {};
  return wanted ? { platformPostId: wanted, postTitle: draft.postTitle.slice(0, 120) } : { platformPostId: null, postId: null, postTitle: null };
}

function validateDraft(draft: Draft) {
  if (!draft.name.trim()) return "برای قانون یک اسم بنویس.";
  if (draft.postMode === "one" && !draft.platformPostId) return draft.trigger === "story_reply" ? "استوری مورد نظر را انتخاب کن." : "پست مورد نظر را انتخاب کن.";
  if (!parseKeywords(draft.keywords).length) return "حداقل یک کلمه لازم است؛ بدون کلمه، قانون به همهٔ کامنت‌ها دایرکت می‌دهد.";
  if (!draft.dmMessage.trim()) return "متن دایرکت خالی است.";
  if (draft.dmMessage.trim().length > DM_LIMIT) return `متن دایرکت حداکثر ${DM_LIMIT.toLocaleString("fa-IR")} نویسه می‌تواند باشد.`;
  if (draft.repeatMode === "every_comment" && !(Number(draft.cooldownHours) >= 1)) return "فاصلهٔ استراحت باید حداقل ۱ ساعت باشد.";
  return "";
}

export function AutomationPanel({ profileId, accounts }: { profileId: string; accounts: SocialAccount[] }) {
  const eligibleAccounts = useMemo(() => accounts.filter((account) => account.platform === "instagram" || account.platform === "facebook"), [accounts]);
  const [accountId, setAccountId] = useState("");
  const [items, setItems] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // null = new rule
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostics>>({});
  const [sampleComment, setSampleComment] = useState("");
  const [samplePostId, setSamplePostId] = useState("");
  const [posts, setPosts] = useState<PlatformPost[]>([]);
  const [stories, setStories] = useState<ActiveStory[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");

  const account = eligibleAccounts.find((item) => (item._id || item.id) === accountId);
  const isInstagram = account?.platform === "instagram";

  useEffect(() => {
    if (eligibleAccounts.some((item) => (item._id || item.id) === accountId)) return;
    const first = eligibleAccounts.find((item) => item.platform === "instagram") || eligibleAccounts[0];
    setAccountId(first?._id || first?.id || "");
    setItems([]);
    setEditingId(null);
    setDraft(emptyDraft);
  }, [eligibleAccounts, accountId]);

  const loadAutomations = useCallback(async () => {
    if (!profileId || !accountId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ profileId, accountId });
      const response = await fetch(`/api/zernio/comment-automations?${query}`, { cache: "no-store" });
      const data: ApiEnvelope<AutomationRule> = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت قانون‌ها ناموفق بود (${response.status}).`));
      setItems(readList(data, "automations", "data"));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "دریافت قانون‌ها ناموفق بود." });
    } finally {
      setLoading(false);
    }
  }, [profileId, accountId]);

  useEffect(() => { void loadAutomations(); }, [loadAutomations]);

  // Recent posts (and active stories on Instagram) of the selected account, for binding a rule to one post.
  const loadMedia = useCallback(async () => {
    if (!accountId) return;
    setMediaLoading(true);
    setMediaError("");
    try {
      const response = await fetch(`/api/zernio/accounts/${encodeURIComponent(accountId)}/posts`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, `دریافت پست‌ها ناموفق بود (${response.status}).`));
      setPosts(Array.isArray(data.posts) ? data.posts : []);
      if (isInstagram) {
        const storyResponse = await fetch(`/api/zernio/accounts/${encodeURIComponent(accountId)}/stories`, { cache: "no-store" });
        const storyData = await storyResponse.json().catch(() => ({}));
        setStories(storyResponse.ok && Array.isArray(storyData.data) ? storyData.data : []);
      } else {
        setStories([]);
      }
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "دریافت پست‌ها ناموفق بود.");
    } finally {
      setMediaLoading(false);
    }
  }, [accountId, isInstagram]);

  useEffect(() => { setPosts([]); setStories([]); setSamplePostId(""); void loadMedia(); }, [loadMedia]);

  const postById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const storyById = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);

  async function patchRule(rule: AutomationRule, body: Record<string, unknown>, success: string) {
    const id = ruleId(rule);
    if (!id) return false;
    setBusyId(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/zernio/comment-automations/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) throw new Error("یک قانون روشن دیگر همین پست را دارد؛ هر پست فقط یک قانون مخصوص به خودش می‌تواند داشته باشد. آن قانون را ویرایش یا خاموش کن.");
      if (!response.ok) throw new Error(responseError(data, `ذخیره ناموفق بود (${response.status}).`));
      setNotice({ kind: "ok", text: success });
      await loadAutomations();
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "ذخیره ناموفق بود." });
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateDraft(draft);
    if (problem) return setNotice({ kind: "error", text: problem });
    if (editingId) {
      const rule = items.find((item) => ruleId(item) === editingId);
      if (!rule) return;
      const payload = payloadFromDraft(draft, rule.actions);
      // Only send trigger when it changes: Zernio detaches the post binding on a trigger change.
      const triggerChanged = draft.trigger !== (rule.trigger || "comment");
      const body = { ...payload, ...(triggerChanged ? { trigger: draft.trigger } : {}), ...bindingForPatch(draft, rule, triggerChanged) };
      if (await patchRule(rule, body, `قانون «${payload.name}» ذخیره شد.`)) { setEditingId(null); setDraft(emptyDraft); }
      return;
    }
    const payload = payloadFromDraft(draft);
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/zernio/comment-automations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, accountId, trigger: draft.trigger, isActive: true, ...payload, ...bindingForCreate(draft) }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) throw new Error("یک قانون روشن دیگر همین پست را دارد؛ هر پست فقط یک قانون مخصوص به خودش می‌تواند داشته باشد. آن قانون را ویرایش یا خاموش کن.");
      if (!response.ok) throw new Error(responseError(data, `ساخت قانون ناموفق بود (${response.status}).`));
      setDraft(emptyDraft);
      setNotice({ kind: "ok", text: `قانون «${payload.name}» ساخته و روشن شد.` });
      await loadAutomations();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "ساخت قانون ناموفق بود." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: AutomationRule) {
    if (!window.confirm(`قانون «${rule.name || "بدون نام"}» حذف شود؟ این کار برگشت ندارد.`)) return;
    const id = ruleId(rule);
    setBusyId(id);
    try {
      const response = await fetch(`/api/zernio/comment-automations/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, `حذف ناموفق بود (${response.status}).`));
      if (editingId === id) { setEditingId(null); setDraft(emptyDraft); }
      setNotice({ kind: "ok", text: "قانون حذف شد." });
      await loadAutomations();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "حذف ناموفق بود." });
    } finally {
      setBusyId("");
    }
  }

  async function loadReport(rule: AutomationRule) {
    const id = ruleId(rule);
    setBusyId(id);
    try {
      const response = await fetch(`/api/zernio/comment-automations/${encodeURIComponent(id)}/logs?limit=20&accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      const data: Diagnostics = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت گزارش ناموفق بود (${response.status}).`));
      setDiagnostics((current) => ({ ...current, [id]: data }));
    } catch (error) {
      setDiagnostics((current) => ({ ...current, [id]: { error: error instanceof Error ? error.message : "دریافت گزارش ناموفق بود." } }));
    } finally {
      setBusyId("");
    }
  }

  async function addKeyword(rule: AutomationRule, keyword: string) {
    const keywords = expandKeywords([...collapseKeywords(rule.keywords), keyword]);
    if (await patchRule(rule, { keywords }, `«${keyword}» به کلمه‌های «${rule.name}» اضافه شد.`)) await loadReport(rule);
  }

  function startEdit(rule: AutomationRule) {
    setEditingId(ruleId(rule));
    setDraft(draftFromRule(rule));
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const parsedKeywords = parseKeywords(draft.keywords);
  const draftClashes = overlappingKeywords({ id: editingId || "__new__", keywords: parsedKeywords, isActive: true, trigger: draft.trigger, platformPostId: draft.postMode === "one" ? draft.platformPostId : undefined }, items);
  const hasPersian = /[؀-ۿ]/.test(draft.keywords);
  const activeRules = items.filter((item) => item.isActive !== false);
  const sampleResults = sampleComment.trim() ? activeRules.filter((rule) => (rule.trigger || "comment") === "comment").map((rule) => {
    if (rule.platformPostId && samplePostId && rule.platformPostId !== samplePostId) return { rule, matched: false, reason: "این قانون فقط برای یک پست دیگر است" };
    return { rule, ...predictMatch(rule, sampleComment) };
  }) : [];
  const sampleHits = sampleResults.filter((result) => result.matched);

  if (!eligibleAccounts.length) return <section className="panel-card"><p className="empty-note">پاسخ خودکار برای اینستاگرام و فیسبوک کار می‌کند؛ اول یکی از این حساب‌ها را از بخش «حساب‌های متصل» وصل کن.</p></section>;

  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <div className="grid gap-6">
      {eligibleAccounts.length > 1 && <label className="compose-label account-picker">حساب<select className="field" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{eligibleAccounts.map((item) => { const id = item._id || item.id || ""; return <option key={id} value={id}>{accountOptionLabel(item)}</option>; })}</select></label>}
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "error-note" : "success-note"}>{notice.text}</p>}

      <section className="panel-card">
        <div className="mb-2 flex items-center justify-between"><h2 className="section-title">قانون‌ها</h2><button className="button-quiet" disabled={loading} onClick={() => void loadAutomations()}>{loading ? "در حال دریافت…" : "تازه‌سازی"}</button></div>
        {items.length ? <ul className="plain-list">{items.map((rule) => {
          const id = ruleId(rule);
          const report = diagnostics[id];
          const clashes = rule.isActive === false ? [] : overlappingKeywords(rule, items);
          const words = collapseKeywords(rule.keywords);
          const persianWithStrictMode = rule.matchMode && rule.matchMode !== "contains" && words.some((word) => /[؀-ۿ]/.test(word));
          return <li className={`list-row rule-row ${editingId === id ? "rule-editing" : ""}`} key={id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="rule-name">{rule.name || "بدون نام"}</strong>
                <p className="muted m-0">{rule.trigger === "story_reply" ? (rule.platformPostId ? "جواب به یک استوری مشخص" : "جواب به هر استوری") : (rule.platformPostId ? "کامنت زیر یک پست مشخص" : "کامنت زیر هر پستی")} · {rule.repeatPolicy?.mode === "every_comment" ? `به هر کامنت، با ${fa(rule.repeatPolicy.cooldownHours || 0)} ساعت فاصله برای هر نفر` : "هر نفر فقط یک بار"}</p>
              </div>
              <span className={`badge ${rule.isActive === false ? "badge-off" : ""}`}>{rule.isActive === false ? "خاموش" : "روشن"}</span>
            </div>
            {rule.platformPostId && (() => {
              const post = postById.get(rule.platformPostId);
              const story = storyById.get(rule.platformPostId);
              const title = post ? captionSnippet(post.message, 90) || "بدون کپشن" : rule.postTitle || "پست قدیمی‌تر";
              const link = post?.permalink || story?.permalink;
              return <div className="bound-post"><PostThumb src={post?.picture || story?.thumbnailUrl || story?.mediaUrl} label={title} /><span className="min-w-0 flex-1"><span className="bound-post-title">{title}</span>{link && <a className="bound-post-link" href={link} target="_blank" rel="noreferrer">دیدن در اینستاگرام ↗</a>}</span></div>;
            })()}
            <div className="chip-list mt-2">{words.length ? words.map((word) => <span className="chip" key={word}>{word}</span>) : <span className="chip chip-warn">بدون کلمه = همهٔ کامنت‌ها</span>}</div>
            <p className="stat-line">{fa(rule.stats?.triggered)} بار فعال شد · {fa(rule.stats?.dmsSent)} دایرکت رفت{rule.stats?.dmsFailed ? <> · <span className="text-error">{fa(rule.stats.dmsFailed)} ناموفق</span></> : null}</p>
            {persianWithStrictMode && <p className="warn-note">روش «{rule.matchMode === "exact" ? "کل متن" : "کلمهٔ کامل"}» با کامنت‌های فارسی اغلب جواب نمی‌دهد. <button className="link-button" disabled={busyId === id} onClick={() => void patchRule(rule, { matchMode: "contains" }, "روش تطبیق به «شامل کلمه» تغییر کرد.")}>درستش کن</button></p>}
            {clashes.length > 0 && <p className="warn-note">کلمهٔ «{clashes[0].keyword}» در قانون «{clashes[0].other}» هم هست؛ کسی که آن را کامنت کند دو دایرکت می‌گیرد. بهتر است این دو قانون یکی شوند.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-secondary" disabled={busyId === id} onClick={() => startEdit(rule)}>ویرایش</button>
              <button className="button-secondary" disabled={busyId === id} onClick={() => void patchRule(rule, { isActive: rule.isActive === false }, rule.isActive === false ? "قانون روشن شد." : "قانون خاموش شد.")}>{rule.isActive === false ? "روشن کن" : "خاموش کن"}</button>
              <button className="button-quiet" disabled={busyId === id} onClick={() => void loadReport(rule)}>{busyId === id && !report ? "در حال بررسی…" : "گزارش"}</button>
              <button className="button-danger ms-auto" disabled={busyId === id} onClick={() => void deleteRule(rule)}>حذف</button>
            </div>
            {report && <div className="report">{report.error ? <p className="error-note">{report.error}</p> : <>
              {(report.misses?.total || 0) > 0 && <div className="mb-3">
                <p className="m-0"><strong>{fa(report.misses?.total)} کامنت</strong> در {fa(report.misses?.retentionDays || 14)} روز اخیر رسید ولی با هیچ کلمه‌ای جور نبود:</p>
                {(report.misses?.samples || []).filter((sample, index, all) => all.findIndex((other) => other.commentText === sample.commentText && other.excludedBy === sample.excludedBy) === index).map((sample, index) => <div className="miss-row" key={index}><span dir="auto">«{sample.commentText || ""}»</span><span className="muted">{sample.excludedBy ? `به‌خاطر کلمهٔ استثنا «${sample.excludedBy}»` : sample.commenterName}</span>{!sample.excludedBy && sample.commentText && sample.commentText.length <= 40 && <button className="link-button" disabled={busyId === id} onClick={() => void addKeyword(rule, sample.commentText || "")}>اضافه به کلمه‌ها</button>}</div>)}
              </div>}
              {report.logs?.length ? <ul className="plain-list">{report.logs.map((log, index) => <li className="log-row" key={log.id || index}>
                <span className={`log-status log-${log.status}`}>{logStatusLabel(log.status)}</span>
                <span className="min-w-0 flex-1"><span dir="auto">{log.commenterUsername ? `@${log.commenterUsername}` : log.commenterName || "کاربر"}: «{log.commentText || ""}»</span>
                  {log.error && <span className="log-detail">{explainError(log.error)}</span>}
                  {log.commentReplyStatus === "failed" && <span className="log-detail">پاسخ عمومی نرفت: {explainError(log.commentReplyError)}</span>}
                  {log.commentReplyStatus === "sent" && <span className="log-detail">پاسخ عمومی هم زیر کامنت رفت.</span>}
                </span>
                <time className="muted">{log.createdAt ? new Date(log.createdAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : ""}</time>
              </li>)}</ul> : <p className="muted m-0">هنوز هیچ کامنتی این قانون را فعال نکرده.</p>}
            </>}</div>}
          </li>;
        })}</ul> : <p className="empty-note">{loading ? "در حال دریافت…" : "هنوز قانونی برای این حساب نیست. از فرم کناری اولی را بساز."}</p>}
      </section>

      <section className="panel-card">
        <h2 className="section-title">آزمایش یک کامنت</h2>
        <p className="muted mt-1">یک کامنت فرضی بنویس تا ببینی کدام قانون‌های روشن به آن جواب می‌دهند. چیزی فرستاده نمی‌شود.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input className="field" value={sampleComment} onChange={(event) => setSampleComment(event.target.value)} placeholder="مثلاً: سلام قیمتش چنده؟" aria-label="کامنت آزمایشی" />
          {items.some((rule) => rule.platformPostId) && <select className="field" value={samplePostId} onChange={(event) => setSamplePostId(event.target.value)} aria-label="کامنت زیر کدام پست"><option value="">زیر هر پستی</option>{posts.map((post) => <option key={post.id} value={post.id}>{captionSnippet(post.message, 35) || "بدون کپشن"}</option>)}</select>}
        </div>
        {sampleComment.trim() && <div className="mt-3">{sampleHits.length === 0
          ? <p className="warn-note">هیچ قانون روشنی به این کامنت جواب نمی‌دهد.</p>
          : sampleHits.length > 1
            ? <p className="warn-note">{fa(sampleHits.length)} قانون فعال می‌شوند ({sampleHits.map((hit) => `«${hit.rule.name}»`).join("، ")})؛ این نفر چند دایرکت می‌گیرد.</p>
            : <p className="success-note">قانون «{sampleHits[0].rule.name}» جواب می‌دهد — {sampleHits[0].reason}.</p>}
          {sampleResults.filter((result) => !result.matched).map((result) => <p className="muted m-0 mt-1" key={ruleId(result.rule)}>«{result.rule.name}»: {result.reason}</p>)}
        </div>}
      </section>
    </div>

    <section className="panel-card compose-panel rule-editor">
      <div className="flex items-center justify-between gap-3"><h2 className="section-title">{editingId ? `ویرایش «${items.find((item) => ruleId(item) === editingId)?.name || ""}»` : "قانون تازه"}</h2>{editingId && <button className="button-quiet" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>انصراف</button>}</div>
      <form className="mt-5" onSubmit={saveDraft}>
        <label className="compose-label">اسم قانون<input className="field" value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="مثلاً: لیست قیمت" /></label>

        {isInstagram && <div className="compose-field"><span>وقتی کسی…</span>
          <div className="segmented" role="group" aria-label="محرک">
            {([["comment", "زیر پست کامنت گذاشت"], ["story_reply", "به استوری جواب داد"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={draft.trigger === value} onClick={() => setDraft((current) => current.trigger === value ? current : { ...current, trigger: value, platformPostId: "", postTitle: "" })}>{label}</button>)}
          </div>
        </div>}

        <div className="compose-field"><span>{draft.trigger === "story_reply" ? "روی کدام استوری؟" : "زیر کدام پست؟"}</span>
          <PostPicker trigger={draft.trigger} mode={draft.postMode} onModeChange={(mode) => setDraft((current) => ({ ...current, postMode: mode, ...(mode === "any" ? { platformPostId: "", postTitle: "" } : {}) }))} posts={posts} stories={stories} loading={mediaLoading} error={mediaError} value={draft.platformPostId} fallbackTitle={draft.postTitle} onChange={(selection) => setDraft((current) => ({ ...current, ...selection }))} onReload={() => void loadMedia()} />
        </div>

        <div className="compose-field"><span>و در متنش یکی از این کلمه‌ها بود</span>
          <KeywordInput label="کلمه‌های کلیدی" value={draft.keywords} onChange={(value) => set("keywords", value)} placeholder="یک کلمه بنویس و Enter بزن، مثلاً قیمت" />
          <span className="field-hint">هر کلمه را بنویس و <kbd>Enter</kbd> یا ویرگول بزن تا اضافه شود؛ هر تعداد که بخواهی. فارسی و انگلیسی را جدا اضافه کن (مثلاً «هرمس» و «Hermes»). املای عربی (ي/ك)، نیم‌فاصله و اعداد فارسی/انگلیسی خودکار پوشش داده می‌شوند.</span>
        </div>
        {draftClashes.length > 0 && <p className="warn-note">«{draftClashes[0].keyword}» در قانون «{draftClashes[0].other}» هم هست؛ کسی که آن را کامنت کند دو دایرکت می‌گیرد.</p>}

        <div className="compose-options">
          <label className="compose-field">روش تطبیق
            <select className="field" value={draft.matchMode} onChange={(event) => set("matchMode", event.target.value as MatchMode)}>
              <option value="contains">کلمه هر جای کامنت باشد</option>
              <option value="word">فقط به‌صورت کلمهٔ جدا</option>
              <option value="exact">کل کامنت دقیقاً همین باشد</option>
            </select>
            {hasPersian && draft.matchMode !== "contains" && <span className="field-hint text-warn">برای کلمه‌های فارسی گزینهٔ اول مطمئن‌تر است.</span>}
          </label>
          <div className="compose-field"><span>جز وقتی که این‌ها هم بود (اختیاری)</span>
            <KeywordInput label="کلمه‌های استثنا" tone="exclude" value={draft.excludeKeywords} onChange={(value) => set("excludeKeywords", value)} placeholder="مثلاً لغو" />
          </div>
        </div>

        <label className="compose-label">این دایرکت برایش برود
          <textarea className="field" rows={5} maxLength={DM_LIMIT} value={draft.dmMessage} onChange={(event) => set("dmMessage", event.target.value)} placeholder="سلام! لیست قیمت‌ها اینجاست…" />
          <span className="char-count">{draft.dmMessage.length.toLocaleString("fa-IR")} / {DM_LIMIT.toLocaleString("fa-IR")}</span>
        </label>

        {draft.trigger === "comment" && <label className="compose-label">و این جواب زیر کامنتش (اختیاری)
          <input className="field" maxLength={2200} value={draft.commentReply} onChange={(event) => set("commentReply", event.target.value)} placeholder="مثلاً: دایرکتت رو چک کن 🌱" />
          {draft.commentReply.trim() && <span className="check-row"><input type="checkbox" checked={draft.replyAlways} onChange={(event) => set("replyAlways", event.target.checked)} />حتی وقتی دایرکت نرفت (مثلاً قبلاً گرفته بود) هم جواب عمومی بده</span>}
        </label>}

        <div className="compose-field"><span>اگر یک نفر دوباره کامنت گذاشت</span>
          <div className="segmented" role="group" aria-label="تکرار">
            <button type="button" aria-pressed={draft.repeatMode === "every_comment"} onClick={() => set("repeatMode", "every_comment")}>دوباره جواب بده</button>
            <button type="button" aria-pressed={draft.repeatMode === "once"} onClick={() => set("repeatMode", "once")}>فقط بار اول</button>
          </div>
          {draft.repeatMode === "every_comment"
            ? <span className="field-hint inline-field">ولی به یک نفر زودتر از هر <input className="field field-tiny" type="number" min={1} max={8760} value={draft.cooldownHours} onChange={(event) => set("cooldownHours", event.target.value)} aria-label="فاصله به ساعت" /> ساعت دوباره دایرکت نده.</span>
            : <span className="field-hint">هر نفر برای همیشه فقط یک دایرکت از این قانون می‌گیرد؛ کامنت‌های بعدی‌اش بی‌جواب می‌ماند.</span>}
        </div>

        <div className="compose-submit"><button className="button-primary" disabled={saving || Boolean(busyId)}>{saving ? "در حال ذخیره…" : editingId ? "ذخیرهٔ تغییرات" : "ساخت و روشن کردن"}</button></div>
      </form>
    </section>
  </div>;
}
