"use client";

import { useRef, useState } from "react";

/** Separator between replies inside the draft string, so a single reply can span several lines. */
export const REPLY_SEP = String.fromCharCode(31);

/**
 * List-style field for public comment replies: each reply is added with Enter or the add button and shows as a removable card.
 * Each reply may be multi-line. The value is a string joined with REPLY_SEP, which payloadFromDraft() splits into commentReply + variations.
 */
export function ReplyInput({ value, onChange, max, placeholder, label }: {
  value: string;
  onChange: (value: string) => void;
  max: number;
  placeholder?: string;
  label: string;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replies = value.split(REPLY_SEP).map((item) => item.trim()).filter(Boolean);
  const full = replies.length >= max;

  function commit(raw: string) {
    const reply = raw.trim();
    if (!reply) return;
    if (replies.length < max && !replies.includes(reply)) onChange([...replies, reply].join(REPLY_SEP));
    setText("");
  }

  function remove(index: number) {
    onChange(replies.filter((_, position) => position !== index).join(REPLY_SEP));
    inputRef.current?.focus();
  }

  return <div className="reply-input">
    {replies.length > 0 && <ol className="reply-list">
      {replies.map((reply, index) => <li className="reply-item" key={reply}>
        <span className="reply-index">{(index + 1).toLocaleString("fa-IR")}</span>
        <span className="reply-text" dir="auto">{reply}</span>
        <button type="button" aria-label={`حذف جواب ${index + 1}`} onClick={() => remove(index)}>×</button>
      </li>)}
    </ol>}
    {full
      ? <p className="field-hint m-0">به حداکثر {max.toLocaleString("fa-IR")} جواب رسیدی؛ برای اضافه کردن، اول یکی را حذف کن.</p>
      : <div className="reply-add">
        <textarea
          ref={inputRef}
          className="field"
          rows={3}
          value={text}
          maxLength={2200}
          aria-label={label}
          placeholder={replies.length ? "متن بعدی…" : placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(text); } }}
        />
        <button type="button" className="button-secondary" disabled={!text.trim()} onClick={() => commit(text)}>+ افزودن</button>
      </div>}
  </div>;
}
