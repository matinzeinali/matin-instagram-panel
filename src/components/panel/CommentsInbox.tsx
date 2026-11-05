"use client";

import { useCallback, useEffect, useState } from "react";
import { responseError } from "./types";
import { captionSnippet, PostThumb } from "./PostPicker";

// Shapes from Zernio: GET /inbox/comments lists posts that have comments;
// GET /inbox/comments/{postId} returns that post's comments (with their replies).
type CommentedPost = { id: string; content?: string; picture?: string | null; permalink?: string | null; createdTime?: string; commentCount?: number; isAd?: boolean };
type CommentAuthor = { id?: string; name?: string; username?: string; isOwner?: boolean };
type PostComment = { id: string; message?: string; createdTime?: string; from?: CommentAuthor; likeCount?: number; replyCount?: number; url?: string | null; replies?: PostComment[]; canReply?: boolean };

const when = (value?: string) => value ? new Date(value).toLocaleString("fa-IR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const authorName = (from?: CommentAuthor) => from?.username ? `@${from.username}` : from?.name || "کاربر";

export function CommentsInbox({ accountId }: { accountId: string }) {
  const [posts, setPosts] = useState<CommentedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const loadPosts = useCallback(async () => {
    if (!accountId) return;
    setPostsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ accountId, limit: "50", sortBy: "date", sortOrder: "desc" });
      const response = await fetch(`/api/zernio/inbox/comments?${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, `دریافت پست‌ها ناموفق بود (${response.status}).`));
      const list: CommentedPost[] = (Array.isArray(data.data) ? data.data : []).filter((post: CommentedPost) => !post.isAd);
      setPosts(list);
      setSelectedPostId((current) => current && list.some((post) => post.id === current) ? current : list.find((post) => (post.commentCount || 0) > 0)?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت پست‌ها ناموفق بود.");
    } finally {
      setPostsLoading(false);
    }
  }, [accountId]);

  const loadComments = useCallback(async (postId: string) => {
    if (!postId || !accountId) return;
    setCommentsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ accountId, limit: "50" });
      const response = await fetch(`/api/zernio/inbox/comments/${encodeURIComponent(postId)}?${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, `دریافت کامنت‌ها ناموفق بود (${response.status}).`));
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (cause) {
      setComments([]);
      setError(cause instanceof Error ? cause.message : "دریافت کامنت‌ها ناموفق بود.");
    } finally {
      setCommentsLoading(false);
    }
  }, [accountId]);

  useEffect(() => { setPosts([]); setComments([]); setSelectedPostId(""); void loadPosts(); }, [loadPosts]);
  useEffect(() => { setReplyTo(null); setReplyText(""); setSent(""); setComments([]); if (selectedPostId) void loadComments(selectedPostId); }, [selectedPostId, loadComments]);

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!replyTo || !replyText.trim() || !selectedPostId) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/zernio/inbox/comments/${encodeURIComponent(selectedPostId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, commentId: replyTo.id, message: replyText.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, `ارسال پاسخ ناموفق بود (${response.status}).`));
      setSent(`جوابت زیر کامنت ${authorName(replyTo.from)} رفت.`);
      setReplyTo(null);
      setReplyText("");
      await loadComments(selectedPostId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ارسال پاسخ ناموفق بود.");
    } finally {
      setSending(false);
    }
  }

  const selectedPost = posts.find((post) => post.id === selectedPostId);

  function renderComment(comment: PostComment, isReply = false) {
    const mine = comment.from?.isOwner;
    const replying = replyTo?.id === comment.id;
    return <li key={comment.id} className={`comment-item ${isReply ? "comment-reply" : ""} ${mine ? "comment-mine" : ""} ${replying ? "comment-replying" : ""}`}>
      <div className="comment-head">
        <strong dir="ltr">{authorName(comment.from)}</strong>
        {mine && <span className="user-role">خودت</span>}
        <time className="comment-time">{when(comment.createdTime)}</time>
      </div>
      <p className="comment-text" dir="auto">{comment.message || "(بدون متن)"}</p>
      <div className="comment-actions">
        {!mine && comment.canReply !== false && <button type="button" className="link-button" onClick={() => { setReplyTo(comment); setSent(""); }}>پاسخ</button>}
        {comment.likeCount ? <span className="comment-time">♥ {comment.likeCount.toLocaleString("fa-IR")}</span> : null}
        {comment.url && <a className="comment-time" href={comment.url} target="_blank" rel="noreferrer">دیدن در اینستاگرام ↗</a>}
      </div>
      {replying && <form className="reply-box" onSubmit={sendReply}>
        <p className="reply-box-quote">در جواب <strong dir="ltr">{authorName(comment.from)}</strong>: «{captionSnippet(comment.message, 80)}»</p>
        <div className="inline-save">
          <input className="field" autoFocus value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="جوابت را بنویس… (عمومی، زیر همین کامنت)" aria-label={`پاسخ به ${authorName(comment.from)}`} />
          <button className="button-primary" disabled={sending || !replyText.trim()}>{sending ? "در حال ارسال…" : "بفرست"}</button>
          <button type="button" className="button-quiet" onClick={() => { setReplyTo(null); setReplyText(""); }}>انصراف</button>
        </div>
      </form>}
      {comment.replies && comment.replies.length > 0 && <ul className="plain-list">{comment.replies.map((reply) => renderComment(reply, true))}</ul>}
    </li>;
  }

  return <>
    {error && <p role="alert" className="error-note mb-4">{error}</p>}
    <div className="inbox-layout">
      <div className="conversation-list">
        <div className="conversation-list-head"><strong>پست‌های دارای کامنت</strong><button type="button" className="button-quiet" disabled={postsLoading} onClick={() => void loadPosts()}>{postsLoading ? "…" : "تازه‌سازی"}</button></div>
        {posts.map((post) => <button key={post.id} className={`conversation-item ${post.id === selectedPostId ? "conversation-active" : ""}`} onClick={() => setSelectedPostId(post.id)}>
          <PostThumb src={post.picture} label={captionSnippet(post.content, 40) || "پست"} />
          <span className="conversation-copy">
            <span className="conversation-preview comment-post-caption">{captionSnippet(post.content, 60) || "بدون کپشن"}</span>
            <span className="conversation-meta">{(post.commentCount || 0).toLocaleString("fa-IR")} کامنت{post.createdTime ? ` · ${new Date(post.createdTime).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}` : ""}</span>
          </span>
        </button>)}
        {!posts.length && <p className="conversation-empty">{postsLoading ? "در حال دریافت…" : "پستی با کامنت پیدا نشد."}</p>}
        <p className="conversation-empty comment-cache-note">زرنیو این فهرست را تا ۱۰ دقیقه نگه می‌دارد؛ کامنت خیلی تازه ممکن است کمی دیرتر برسد.</p>
      </div>

      <div className="message-pane">
        {selectedPost ? <>
          <div className="comment-post-head">
            <PostThumb src={selectedPost.picture} label="تصویر پست" />
            <span className="min-w-0 flex-1"><span className="bound-post-title">{captionSnippet(selectedPost.content, 140) || "بدون کپشن"}</span>{selectedPost.permalink && <a className="bound-post-link" href={selectedPost.permalink} target="_blank" rel="noreferrer">دیدن پست ↗</a>}</span>
            <button type="button" className="button-quiet" disabled={commentsLoading} onClick={() => void loadComments(selectedPost.id)}>تازه‌سازی</button>
          </div>
          {sent && <p role="status" className="success-note mb-3">{sent}</p>}
          <div className="message-list">
            {commentsLoading && !comments.length ? <p className="empty-note"><span className="spinner" aria-hidden="true" /> در حال دریافت کامنت‌ها…</p>
              : comments.length ? <ul className="plain-list">{comments.map((comment) => renderComment(comment))}</ul>
              : <p className="empty-note">این پست هنوز کامنتی ندارد.</p>}
          </div>
        </> : <div className="message-placeholder"><strong>یک پست را انتخاب کن</strong><p>کامنت‌های همان پست اینجا نمایش داده می‌شوند و می‌توانی زیر هر کدام جواب بدهی.</p></div>}
      </div>
    </div>
  </>;
}
