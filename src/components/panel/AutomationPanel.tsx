"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SocialAccount } from "./types";
import { accountOptionLabel, readList, responseError, type ApiEnvelope } from "./types";
import { KeywordInput } from "./KeywordInput";
import { ReplyInput, REPLY_SEP } from "./ReplyInput";
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
  requireFollow: boolean; followMessage: string; followButton: string; notFollowingMessage: string;
  dmVariations: string; buttons: Array<{ title: string; url: string }>; delayValue: string; delayUnit: DelayUnit; typoTolerance: boolean;
};

const FOLLOW_MESSAGE = "سلام! برای دریافت پیام، اول پیج ما را دنبال کن و بعد روی دکمهٔ زیر بزن 🙏";
const FOLLOW_BUTTON = "فالو کردم ✅";
const NOT_FOLLOWING_MESSAGE = "هنوز پیج را دنبال نکرده‌ای. اول فالو کن و دوباره روی دکمه بزن 🙂";
const emptyDraft: Draft = { name: "", trigger: "comment", keywords: "", excludeKeywords: "", matchMode: "contains", dmMessage: "", commentReply: "", repeatMode: "every_comment", cooldownHours: "24", replyAlways: false, postMode: "any", platformPostId: "", postTitle: "", requireFollow: false, followMessage: FOLLOW_MESSAGE, followButton: FOLLOW_BUTTON, notFollowingMessage: NOT_FOLLOWING_MESSAGE, dmVariations: "", buttons: [], delayValue: "0", delayUnit: "m", typoTolerance: false };
const DM_LIMIT = 1000;
const DM_LIMIT_WITH_BUTTONS = 640; // Meta/Zernio limit when the DM carries buttons
const MAX_DM_VARIATIONS = 5;
const MAX_BUTTONS = 3;
const MAX_DELAY_SECONDS = 86400;
type DelayUnit = "s" | "m" | "h";
const DELAY_FACTOR: Record<DelayUnit, number> = { s: 1, m: 60, h: 3600 };
const dmLimitOf = (draft: Pick<Draft, "buttons">) => (draft.buttons.length ? DM_LIMIT_WITH_BUTTONS : DM_LIMIT);
const splitLines = (value: string, max: number) => value.split(REPLY_SEP).map((item) => item.trim()).filter(Boolean).slice(0, max);
const delaySeconds = (draft: Pick<Draft, "delayValue" | "delayUnit">) => Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round((Number(draft.delayValue) || 0) * DELAY_FACTOR[draft.delayUnit])));
function delayFromSeconds(seconds = 0): Pick<Draft, "delayValue" | "delayUnit"> {
  if (seconds > 0 && seconds % 3600 === 0) return { delayValue: String(seconds / 3600), delayUnit: "h" };
  if (seconds > 0 && seconds % 60 === 0) return { delayValue: String(seconds / 60), delayUnit: "m" };
  return { delayValue: String(seconds), delayUnit: "s" };
}
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
    commentReply: [rule.commentReply, ...(rule.commentReplyVariations || [])].filter(Boolean).join(REPLY_SEP),
    repeatMode: rule.repeatPolicy?.mode || "once",
    cooldownHours: String(rule.repeatPolicy?.cooldownHours || 24),
    replyAlways: rule.publicReplyPolicy === "always",
    postMode: rule.platformPostId ? "one" : "any",
    platformPostId: rule.platformPostId || "",
    postTitle: rule.postTitle || "",
    requireFollow: rule.audience?.followerStatus === "follower",
    followMessage: rule.followGate?.message || FOLLOW_MESSAGE,
    followButton: rule.followGate?.buttonLabel || FOLLOW_BUTTON,
    notFollowingMessage: rule.followGate?.notFollowingMessage || NOT_FOLLOWING_MESSAGE,
    dmVariations: (rule.dmMessageVariations || []).join(REPLY_SEP),
    buttons: (rule.buttons || []).filter((button) => (button.type || "url") === "url").map((button) => ({ title: button.title || "", url: button.url || "" })),
    ...delayFromSeconds(rule.dmDelaySeconds),
    typoTolerance: Boolean(rule.typoTolerance),
  };
}

const MAX_REPLIES = 6; // main reply + up to 5 variations (Zernio limit)
const splitReplies = (value: string) => value.split(REPLY_SEP).map((item) => item.trim()).filter(Boolean).slice(0, MAX_REPLIES);

/** Fields sent to Zernio for both create (POST) and update (PATCH). */
function payloadFromDraft(draft: Draft, actions?: AutomationRule["actions"], canGate = true) {
  const replies = splitReplies(draft.commentReply);
  const cooldown = Math.min(8760, Math.max(1, Math.round(Number(draft.cooldownHours) || 24)));
  return {
    name: draft.name.trim(),
    keywords: expandKeywords(parseKeywords(draft.keywords)),
    excludeKeywords: expandKeywords(parseKeywords(draft.excludeKeywords)),
    matchMode: draft.matchMode,
    dmMessage: draft.dmMessage.trim(),
    // Follow gate: followers get the DM; non-followers (or unknown) get a "follow me" message with a confirm button, and the real DM is sent once they tap it and are verified.
    audience: canGate && draft.requireFollow ? { followerStatus: "follower", whenUnknown: "verify" } : { followerStatus: "any", whenUnknown: "send" },
    ...(canGate && draft.requireFollow ? { followGate: { message: draft.followMessage.trim() || FOLLOW_MESSAGE, buttonLabel: draft.followButton.trim().slice(0, 20) || FOLLOW_BUTTON, notFollowingMessage: draft.notFollowingMessage.trim() || NOT_FOLLOWING_MESSAGE } } : {}),
    dmMessageVariations: splitLines(draft.dmVariations, MAX_DM_VARIATIONS),
    buttons: draft.buttons.map((button) => ({ type: "url", title: button.title.trim(), url: button.url.trim() })),
    dmDelaySeconds: delaySeconds(draft),
    typoTolerance: draft.matchMode === "word" && draft.typoTolerance,
    repeatPolicy: draft.repeatMode === "once" ? { mode: "once" } : { mode: "every_comment", cooldownHours: cooldown },
    ...(draft.trigger === "comment" ? {
      // One reply per line: the first is the main reply, the rest are variations Zernio rotates at random.
      commentReply: replies[0] || "",
      commentReplyVariations: replies.slice(1),
      publicReplyPolicy: draft.replyAlways && replies.length ? "always" : "after_dm",
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
  if (draft.dmMessage.trim().length > dmLimitOf(draft)) return `متن دایرکت حداکثر ${dmLimitOf(draft).toLocaleString("fa-IR")} نویسه می‌تواند باشد${draft.buttons.length ? " (وقتی دکمه داری)" : ""}.`;
  if (draft.requireFollow && draft.followMessage.trim().length > 640) return "پیام درخواست فالو حداکثر ۶۴۰ نویسه می‌تواند باشد.";
  if (draft.buttons.some((button) => !button.title.trim() || !/^https?:\/\/\S+$/i.test(button.url.trim()))) return "هر دکمه باید متن و لینکی داشته باشد که با http:// یا https:// شروع شود.";
  if (splitLines(draft.dmVariations, MAX_DM_VARIATIONS).some((text) => text.length > dmLimitOf(draft))) return `هر متن چرخشی حداکثر ${dmLimitOf(draft).toLocaleString("fa-IR")} نویسه می‌تواند باشد.`;
  if (!(Number(draft.delayValue) >= 0) || (Number(draft.delayValue) || 0) * DELAY_FACTOR[draft.delayUnit] > MAX_DELAY_SECONDS) return "تأخیر حداکثر ۲۴ ساعت می‌تواند باشد.";
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
  const [formOpen, setFormOpen] = useState(false);
  const [reportId, setReportId] = useState("");
  const [sortBy, setSortBy] = useState<"created" | "post" | "triggered">("created");
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
    setFormOpen(false);
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

  // Display order: newest rule first, newest post first (rules without a post go last), or most triggered first.
  const sortedItems = useMemo(() => {
    const time = (value?: string | null) => (value ? new Date(value).getTime() || 0 : 0);
    const postTime = (rule: AutomationRule) => rule.platformPostId ? time(postById.get(rule.platformPostId)?.createdTime || storyById.get(rule.platformPostId)?.timestamp) : 0;
    const list = [...items];
    if (sortBy === "created") list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    else if (sortBy === "post") list.sort((a, b) => postTime(b) - postTime(a) || time(b.createdAt) - time(a.createdAt));
    else list.sort((a, b) => (b.stats?.triggered || 0) - (a.stats?.triggered || 0) || time(b.createdAt) - time(a.createdAt));
    return list;
  }, [items, sortBy, postById, storyById]);

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
      const payload = payloadFromDraft(draft, rule.actions, isInstagram);
      // Only send trigger when it changes: Zernio detaches the post binding on a trigger change.
      const triggerChanged = draft.trigger !== (rule.trigger || "comment");
      const body = { ...payload, ...(triggerChanged ? { trigger: draft.trigger } : {}), ...bindingForPatch(draft, rule, triggerChanged) };
      if (await patchRule(rule, body, `قانون «${payload.name}» ذخیره شد.`)) { closeForm(); }
      return;
    }
    const payload = payloadFromDraft(draft, undefined, isInstagram);
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
      closeForm();
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
      if (editingId === id) closeForm();
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
    setFormOpen(true);
  }

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft);
    setNotice(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  useEffect(() => {
    if (!formOpen && !reportId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { if (reportId) setReportId(""); else closeForm(); } };
    window.scrollTo({ top: 0 });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [formOpen, reportId]);

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

  return <div className="grid items-start gap-6">
    <div className={formOpen ? "hidden" : "grid gap-6"}>
      {eligibleAccounts.length > 1 && <label className="compose-label account-picker">حساب<select className="field" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{eligibleAccounts.map((item) => { const id = item._id || item.id || ""; return <option key={id} value={id}>{accountOptionLabel(item)}</option>; })}</select></label>}
      {notice && !formOpen && !reportId && <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "error-note" : "success-note"}>{notice.text}</p>}

      <section className="panel-card rules-section">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><h2 className="section-title">قانون‌ها{items.length > 0 && <span className="muted"> ({fa(items.length)})</span>}</h2><span className="flex flex-wrap items-center gap-2">{items.length > 1 && <div className="sort-pills" role="group" aria-label="مرتب‌سازی">{([["created", "جدیدترین"], ["post", "تاریخ پست"], ["triggered", "پرکارترین"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => setSortBy(value)}>{label}</button>)}</div>}<button className="button-quiet" disabled={loading} onClick={() => void loadAutomations()}>{loading ? "در حال دریافت…" : "تازه‌سازی"}</button><button className="button-primary" onClick={openNew}>+ قانون تازه</button></span></div>
        {items.length ? <ul className="rule-cards">{sortedItems.map((rule, index) => {
          const id = ruleId(rule);
          const clashes = rule.isActive === false ? [] : overlappingKeywords(rule, items);
          const words = collapseKeywords(rule.keywords);
          const persianWithStrictMode = rule.matchMode && rule.matchMode !== "contains" && words.some((word) => /[؀-ۿ]/.test(word));
          return <li className={`rule-card ${editingId === id ? "rule-editing" : ""}`} key={id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="rule-name"><span className="rule-number">{fa(index + 1)}</span>{rule.name || "بدون نام"}</strong>
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
            {(() => {
              const stats = rule.stats || {};
              const ctr = stats.trackedSends ? ` (${Math.round(((stats.uniqueClicks || 0) / stats.trackedSends) * 100).toLocaleString("fa-IR")}٪)` : "";
              const cells: Array<[string, string]> = [["فعال شد", fa(stats.triggered)], ["دایرکت رفت", fa(stats.dmsSent)], ["افراد یکتا", fa(stats.uniqueContacts)], ["کلیک لینک", fa(stats.uniqueClicks) + ctr], ["خوانده شد", fa(stats.read)], ["فالو تأییدشد", `${fa(stats.followGatePassed)} از ${fa(stats.followGateSent)}`]];
              return <>
                <div className="rule-stats">{cells.map(([label, value]) => <div className="rule-stat" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
                {(rule.audience?.followerStatus === "follower" || Boolean(stats.dmsFailed)) && <p className="stat-line">{rule.audience?.followerStatus === "follower" ? "فقط فالوورها" : ""}{rule.audience?.followerStatus === "follower" && stats.dmsFailed ? " · " : ""}{stats.dmsFailed ? <span className="text-error">{fa(stats.dmsFailed)} ناموفق</span> : null}</p>}
              </>;
            })()}
            {persianWithStrictMode && <p className="warn-note">روش «{rule.matchMode === "exact" ? "کل متن" : "کلمهٔ کامل"}» با کامنت‌های فارسی اغلب جواب نمی‌دهد. <button className="link-button" disabled={busyId === id} onClick={() => void patchRule(rule, { matchMode: "contains" }, "روش تطبیق به «شامل کلمه» تغییر کرد.")}>درستش کن</button></p>}
            {clashes.length > 0 && <p className="warn-note">کلمهٔ «{clashes[0].keyword}» در قانون «{clashes[0].other}» هم هست؛ کسی که آن را کامنت کند دو دایرکت می‌گیرد. بهتر است این دو قانون یکی شوند.</p>}
            <div className="rule-actions">
              <button className="button-secondary" disabled={busyId === id} onClick={() => startEdit(rule)}>ویرایش</button>
              <button className="button-secondary" disabled={busyId === id} onClick={() => void patchRule(rule, { isActive: rule.isActive === false }, rule.isActive === false ? "قانون روشن شد." : "قانون خاموش شد.")}>{rule.isActive === false ? "روشن کن" : "خاموش کن"}</button>
              <button className="button-quiet" disabled={busyId === id} onClick={() => { setReportId(id); void loadReport(rule); }}>گزارش</button>
              <button className="button-danger" disabled={busyId === id} onClick={() => void deleteRule(rule)}>حذف</button>
            </div>
          </li>;
        })}</ul> : <div className="empty-note">{loading ? "در حال دریافت…" : <><p className="m-0">هنوز قانونی برای این حساب نیست.</p><button className="button-primary mt-3" onClick={openNew}>+ ساخت اولین قانون</button></>}</div>}
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

    {formOpen && <section className="rule-page panel-card compose-panel" aria-label={editingId ? "ویرایش قانون" : "قانون تازه"}>
      <div className="flex items-center justify-between gap-3"><h2 className="section-title">{editingId ? `ویرایش «${items.find((item) => ruleId(item) === editingId)?.name || ""}»` : "قانون تازه"}</h2><button type="button" className="button-quiet" onClick={closeForm} >→ بازگشت به قانون‌ها</button></div>
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-3 ${notice.kind === "error" ? "error-note" : "success-note"}`}>{notice.text}</p>}
      <form className="mt-5" onSubmit={saveDraft}>
        <section className="form-step"><header className="step-head"><span className="step-num">۱</span><div><h3 className="step-title">قانون چه موقع کار کند؟</h3><p className="step-desc">اسم قانون، نوع محرک و پستی که روی آن اعمال شود.</p></div></header>
        <label className="compose-label">اسم قانون<input className="field" value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="مثلاً: لیست قیمت" /></label>

        {isInstagram && <div className="compose-field"><span>وقتی کسی…</span>
          <div className="segmented" role="group" aria-label="محرک">
            {([["comment", "زیر پست کامنت گذاشت"], ["story_reply", "به استوری جواب داد"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={draft.trigger === value} onClick={() => setDraft((current) => current.trigger === value ? current : { ...current, trigger: value, platformPostId: "", postTitle: "" })}>{label}</button>)}
          </div>
        </div>}

        <div className="compose-field"><span>{draft.trigger === "story_reply" ? "روی کدام استوری؟" : "زیر کدام پست؟"}</span>
          <PostPicker trigger={draft.trigger} mode={draft.postMode} onModeChange={(mode) => setDraft((current) => ({ ...current, postMode: mode, ...(mode === "any" ? { platformPostId: "", postTitle: "" } : {}) }))} posts={posts} stories={stories} loading={mediaLoading} error={mediaError} value={draft.platformPostId} fallbackTitle={draft.postTitle} onChange={(selection) => setDraft((current) => ({ ...current, ...selection }))} onReload={() => void loadMedia()} />
        </div>

        </section>

        <section className="form-step"><header className="step-head"><span className="step-num">۲</span><div><h3 className="step-title">کدام کامنت‌ها؟</h3><p className="step-desc">کلمه‌هایی که اگر در کامنت بود، قانون فعال شود.</p></div></header>
        <div className="compose-field"><span>کلمه‌های کلیدی</span>
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
            {draft.matchMode === "word" && <span className="check-row"><input type="checkbox" checked={draft.typoTolerance} onChange={(event) => set("typoTolerance", event.target.checked)} />غلط املایی کوچک را هم قبول کن (مثلاً hermez به‌جای hermes؛ برای کلمه‌های کوتاه‌تر از ۴ حرف اعمال نمی‌شود)</span>}
            {hasPersian && draft.matchMode !== "contains" && <span className="field-hint text-warn">برای کلمه‌های فارسی گزینهٔ اول مطمئن‌تر است.</span>}
          </label>
          <div className="compose-field"><span>جز وقتی که این‌ها هم بود (اختیاری)</span>
            <KeywordInput label="کلمه‌های استثنا" tone="exclude" value={draft.excludeKeywords} onChange={(value) => set("excludeKeywords", value)} placeholder="مثلاً لغو" />
          </div>
        </div>

        </section>

        <section className="form-step"><header className="step-head"><span className="step-num">۳</span><div><h3 className="step-title">چه چیزی برایشان برود؟</h3><p className="step-desc">متن دایرکت، شرط فالو و جواب زیر کامنت.</p></div></header>
        <label className="compose-label">متن دایرکت
          <textarea className="field" rows={5} maxLength={dmLimitOf(draft)} value={draft.dmMessage} onChange={(event) => set("dmMessage", event.target.value)} placeholder="سلام! لیست قیمت‌ها اینجاست…" />
          <span className="char-count">{draft.dmMessage.length.toLocaleString("fa-IR")} / {dmLimitOf(draft).toLocaleString("fa-IR")}</span>
        </label>

        <div className="compose-field sub-card"><span>چند متن چرخشی دایرکت (اختیاری)</span>
          <ReplyInput label="متن‌های چرخشی دایرکت" max={MAX_DM_VARIATIONS} value={draft.dmVariations} onChange={(value) => set("dmVariations", value)} placeholder="یک متن دیگر بنویس (می‌تواند چند خطی باشد)" />
          <span className="field-hint">متن بالا هم یکی از گزینه‌هاست. برای هر کامنت یکی از همهٔ متن‌ها (تا {MAX_DM_VARIATIONS.toLocaleString("fa-IR")} متن اضافه) تصادفی فرستاده می‌شود تا دایرکت‌ها عین هم نباشند. دکمه‌ها به هر متنی که انتخاب شود می‌چسبند.</span>
        </div>

        <div className="compose-field sub-card"><span>دکمهٔ لینک زیر دایرکت (اختیاری)</span>
          {draft.buttons.map((button, index) => <div className="btn-row" key={index}>
            <input className="field" maxLength={20} value={button.title} onChange={(event) => setDraft((current) => ({ ...current, buttons: current.buttons.map((item, position) => position === index ? { ...item, title: event.target.value } : item) }))} placeholder="متن دکمه، مثلاً دیدن لیست قیمت" aria-label={`متن دکمه ${index + 1}`} />
            <input className="field" dir="ltr" value={button.url} onChange={(event) => setDraft((current) => ({ ...current, buttons: current.buttons.map((item, position) => position === index ? { ...item, url: event.target.value } : item) }))} placeholder="https://example.com" aria-label={`لینک دکمه ${index + 1}`} />
            <button type="button" className="button-quiet" aria-label={`حذف دکمه ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, buttons: current.buttons.filter((_, position) => position !== index) }))}>✕</button>
          </div>)}
          {draft.buttons.length < MAX_BUTTONS && <button type="button" className="button-secondary" onClick={() => setDraft((current) => ({ ...current, buttons: [...current.buttons, { title: "", url: "" }] }))}>+ افزودن دکمه</button>}
          <span className="field-hint">تا {MAX_BUTTONS.toLocaleString("fa-IR")} دکمه. کلیک روی لینک‌ها شمرده می‌شود و در آمار قانون دیده می‌شود. وقتی دکمه داری، متن دایرکت حداکثر {DM_LIMIT_WITH_BUTTONS.toLocaleString("fa-IR")} نویسه است.</span>
        </div>

        {draft.trigger === "comment" && <div className="compose-label sub-card"><span>جواب عمومی زیر کامنت (اختیاری)</span>
          <ReplyInput label="جواب‌های عمومی" max={MAX_REPLIES} value={draft.commentReply} onChange={(value) => set("commentReply", value)} placeholder="یک جواب بنویس، مثلاً: دایرکتت رو چک کن 🌱" />
          <span className="field-hint">هر جواب را بنویس و «+ افزودن» (یا <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) بزن تا اضافه شود (تا {MAX_REPLIES.toLocaleString("fa-IR")} جواب). برای هر کامنت یکی به‌صورت تصادفی انتخاب می‌شود تا جواب‌ها شبیه هم نباشند.</span>
          {splitReplies(draft.commentReply).length > 0 && <span className="check-row"><input type="checkbox" checked={draft.replyAlways} onChange={(event) => set("replyAlways", event.target.checked)} />حتی وقتی دایرکت نرفت (مثلاً قبلاً گرفته بود) هم جواب عمومی بده</span>}
        </div>}

        </section>

        {isInstagram && <section className="form-step"><header className="step-head"><span className="step-num">۴</span><div><h3 className="step-title">فقط به فالوورها بده</h3><p className="step-desc">اگر کاربر فالوور نیست، اول از او بخواه پیج را فالو کند.</p></div></header>
        <div className="compose-field">
          <label className="check-row"><input type="checkbox" checked={draft.requireFollow} onChange={(event) => set("requireFollow", event.target.checked)} />اگر کاربر فالوور نیست، اول از او بخواه پیج را فالو کند</label>
          {draft.requireFollow ? <>
            <span className="field-hint">فالوور: پیام اصلی مستقیم می‌رود. غیرفالوور: پیام زیر با دکمهٔ تأیید می‌رود و بعد از فالو و زدن دکمه، پیام اصلی (یا لینک) برایش ارسال می‌شود.</span>
            <label className="compose-label">پیام درخواست فالو<textarea className="field" rows={3} maxLength={640} value={draft.followMessage} onChange={(event) => set("followMessage", event.target.value)} /></label>
            <label className="compose-label">متن دکمهٔ تأیید<input className="field" maxLength={20} value={draft.followButton} onChange={(event) => set("followButton", event.target.value)} /></label>
            <label className="compose-label">اگر دکمه را زد ولی هنوز فالو نکرده بود<textarea className="field" rows={2} maxLength={640} value={draft.notFollowingMessage} onChange={(event) => set("notFollowingMessage", event.target.value)} /></label>
          </> : <span className="field-hint">خاموش: به همهٔ کامنت‌دهنده‌ها، فالوور باشند یا نه، دایرکت می‌رود.</span>}
        </div>
        </section>}

        <section className="form-step"><header className="step-head"><span className="step-num">{isInstagram ? "۵" : "۴"}</span><div><h3 className="step-title">تکرار و زمان‌بندی</h3><p className="step-desc">اگر کسی دوباره کامنت گذاشت و اینکه دایرکت چقدر بعد برود.</p></div></header>
        <div className="compose-field"><span>رفتار قانون</span>
          <div className="segmented" role="group" aria-label="تکرار">
            <button type="button" aria-pressed={draft.repeatMode === "every_comment"} onClick={() => set("repeatMode", "every_comment")}>دوباره جواب بده</button>
            <button type="button" aria-pressed={draft.repeatMode === "once"} onClick={() => set("repeatMode", "once")}>فقط بار اول</button>
          </div>
          {draft.repeatMode === "every_comment"
            ? <span className="field-hint inline-field">ولی به یک نفر زودتر از هر <input className="field field-tiny" type="number" min={1} max={8760} value={draft.cooldownHours} onChange={(event) => set("cooldownHours", event.target.value)} aria-label="فاصله به ساعت" /> ساعت دوباره دایرکت نده.</span>
            : <span className="field-hint">هر نفر برای همیشه فقط یک دایرکت از این قانون می‌گیرد؛ کامنت‌های بعدی‌اش بی‌جواب می‌ماند.</span>}
        </div>


        <div className="compose-field"><span>تأخیر قبل از ارسال دایرکت</span>
          <div className="delay-row">
            <input className="field field-tiny" type="number" min={0} value={draft.delayValue} onChange={(event) => set("delayValue", event.target.value)} aria-label="مقدار تأخیر" />
            <select className="field" value={draft.delayUnit} onChange={(event) => set("delayUnit", event.target.value as DelayUnit)} aria-label="واحد تأخیر"><option value="s">ثانیه</option><option value="m">دقیقه</option><option value="h">ساعت</option></select>
          </div>
          <span className="field-hint">۰ یعنی فوری. حداکثر ۲۴ ساعت. جواب عمومی هرگز زودتر از دایرکت نمی‌رود. کمی تأخیر، رفتار طبیعی‌تری دارد.</span>
        </div>
        </section>

        <div className="form-actions"><div className="compose-submit"><button className="button-primary" disabled={saving || Boolean(busyId)}>{saving ? "در حال ذخیره…" : editingId ? "ذخیرهٔ تغییرات" : "ساخت و روشن کردن"}</button></div>
        <button type="button" className="button-secondary" onClick={closeForm}>انصراف</button></div>
      </form>
    </section>}

    {reportId && (() => {
      const rule = items.find((item) => ruleId(item) === reportId);
      if (!rule) return null;
      const id = reportId;
      const report = diagnostics[id];
      return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setReportId(""); }}>
        <section className="modal-card panel-card" role="dialog" aria-modal="true" aria-label="گزارش قانون">
          <div className="flex items-center justify-between gap-3"><h2 className="section-title">گزارش «{rule.name || "بدون نام"}»</h2><button type="button" className="button-quiet" onClick={() => setReportId("")}>✕ بستن</button></div>
          {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-3 ${notice.kind === "error" ? "error-note" : "success-note"}`}>{notice.text}</p>}
          <div className="mt-4">{!report ? <p className="muted m-0">در حال دریافت گزارش…</p> : (
            <div className="report">{report.error ? <p className="error-note">{report.error}</p> : <>
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
            </>}</div>
          )}</div>
        </section>
      </div>;
    })()}
  </div>;
}
