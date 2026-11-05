"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conversation, InboxMessage, SocialAccount } from "./types";
import { accountOptionLabel, readList, responseError, type ApiEnvelope } from "./types";
import { CommentsInbox } from "./CommentsInbox";

type Props = { profileId: string; accounts: SocialAccount[] };

export function InboxPanel({ profileId, accounts }: Props) {
  const [mode, setMode] = useState<"messages" | "comments">("messages");
  const [accountId, setAccountId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Also reset when the selected account is no longer in the list (e.g. after switching profile).
    if (!accounts.some((account) => (account._id || account.id) === accountId)) setAccountId(accounts[0]?._id || accounts[0]?.id || "");
  }, [accounts, accountId]);

  const loadConversations = useCallback(async () => {
    if (!accountId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/zernio/inbox/conversations?accountId=${encodeURIComponent(accountId)}&limit=50`, { cache: "no-store" });
      const data: ApiEnvelope<Conversation> = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت گفتگوها ناموفق بود (${response.status}).`));
      const list = readList(data, "data", "conversations");
      setConversations(list);
      setConversationId((current) => current && !list.some((item) => (item.id || item.conversationId) === current) ? "" : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت گفتگوها ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  async function loadMessages(selectedConversationId: string) {
    setConversationId(selectedConversationId);
    setError("");
    try {
      const response = await fetch(`/api/zernio/inbox/conversations/${encodeURIComponent(selectedConversationId)}/messages?accountId=${encodeURIComponent(accountId)}&sortOrder=asc&limit=100`, { cache: "no-store" });
      const data: ApiEnvelope<InboxMessage> = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت پیام‌ها ناموفق بود (${response.status}).`));
      setMessages(readList(data, "messages", "data"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت پیام‌ها ناموفق بود.");
    }
  }

  useEffect(() => {
    if (!accountId) return;
    setConversations([]);
    setMessages([]);
    setConversationId("");
    if (mode === "messages") void loadConversations();
  }, [accountId, mode, profileId, loadConversations]);

  const visibleConversations = conversations.filter((item) => `${item.participantName || ""} ${item.participantId || ""} ${item.lastMessage || ""} ${item.platform || ""}`.toLocaleLowerCase().includes(conversationSearch.trim().toLocaleLowerCase()));

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reply.trim() || !accountId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/zernio/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, message: reply.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(responseError(data, `ارسال پاسخ ناموفق بود (${response.status}).`));
      setReply("");
      await loadMessages(conversationId);
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ارسال پاسخ ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-card">
      <div className="inbox-heading">
        <div className="tabs tabs-inline" role="tablist" aria-label="نوع صندوق">
          <button role="tab" aria-selected={mode === "messages"} className={`tab-button ${mode === "messages" ? "tab-active" : ""}`} onClick={() => setMode("messages")}>دایرکت‌ها</button>
          <button role="tab" aria-selected={mode === "comments"} className={`tab-button ${mode === "comments" ? "tab-active" : ""}`} onClick={() => setMode("comments")}>کامنت‌ها</button>
        </div>
        <div className="inbox-toolbar">
          {accounts.length > 1 && <select className="field" aria-label="حساب اجتماعی" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => { const id = account._id || account.id || ""; return <option key={id} value={id}>{accountOptionLabel(account)}</option>; })}</select>}
          {mode === "messages" && <button className="button-quiet" disabled={busy || !accountId} onClick={() => void loadConversations()}>{busy ? "در حال دریافت…" : "تازه‌سازی"}</button>}
        </div>
      </div>
      {error && <p role="alert" className="error-note mb-4">{error}</p>}
      {!accounts.length ? <p className="empty-note">برای دیدن پیام‌ها، اول یک حساب اجتماعی وصل کن.</p> : mode === "messages" ? <div className="inbox-layout">
        <div className="conversation-list">
          <div className="conversation-list-head"><strong>گفتگوها</strong><span>{conversations.length.toLocaleString("fa-IR")}</span></div>
          <label className="conversation-search"><span aria-hidden="true">⌕</span><input type="search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="جست‌وجوی نام یا متن…" aria-label="جست‌وجوی گفتگو" /></label>
          {visibleConversations.map((conversation) => { const id = conversation.id || conversation.conversationId || ""; return <button key={id} className={`conversation-item ${id === conversationId ? "conversation-active" : ""}`} onClick={() => void loadMessages(id)}><span className="conversation-avatar" aria-hidden="true">{(conversation.participantName || conversation.participantId || "؟").slice(0, 1).toLocaleUpperCase("fa-IR")}</span><span className="conversation-copy"><span className="conversation-item-top"><strong>{conversation.participantName || conversation.participantId || "بدون نام"}</strong>{conversation.unreadCount ? <span className="unread-count" aria-label={`${conversation.unreadCount} پیام خوانده‌نشده`}>{conversation.unreadCount.toLocaleString("fa-IR")}</span> : null}</span><span className="conversation-preview">{conversation.lastMessage || "بدون متن"}</span><span className="conversation-meta">{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }) : ""}</span></span></button>; })}
          {!visibleConversations.length && <p className="conversation-empty">{busy ? "در حال دریافت…" : conversationSearch ? "چیزی پیدا نشد." : "هنوز گفتگویی نیست."}</p>}
        </div>
        <div className="message-pane">{conversationId ? <>
          <div className="message-list">{messages.map((message, index) => <article key={message.id || index} className={`message-bubble ${message.direction === "outgoing" ? "message-outgoing" : "message-incoming"}`}><p className="m-0 whitespace-pre-wrap">{message.message || "(رسانه)"}</p>{message.attachments?.map((attachment, attachmentIndex) => attachment.url ? <a className="message-attachment" href={attachment.url} target="_blank" rel="noreferrer" key={attachmentIndex}>مشاهدهٔ پیوست</a> : null)}<time className="muted block text-xs">{message.createdAt || message.sentAt ? new Date(message.createdAt || message.sentAt || "").toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : ""}</time></article>)}{!messages.length && <p className="empty-note">پیامی در این گفتگو نیست.</p>}</div>
          <form onSubmit={sendReply} className="reply-form"><input className="field" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="پاسخ بنویس…" aria-label="متن پاسخ" /><button disabled={busy || !reply.trim()} className="button-primary">بفرست</button></form>
        </> : <div className="message-placeholder"><strong>یک گفتگو را انتخاب کن</strong><p>پیام‌ها اینجا نمایش داده می‌شوند و می‌توانی همین‌جا جواب بدهی.</p></div>}</div>
      </div> : <CommentsInbox accountId={accountId} />}
    </section>
  );
}
