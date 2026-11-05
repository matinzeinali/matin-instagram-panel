"use client";

import { useRef, useState } from "react";
import { parseKeywords } from "./automationRules";

/**
 * Tag-style keyword field: each word becomes a removable chip.
 * Add with Enter, a comma (, or ،), the + button, by pasting a comma/line separated list, or by leaving the field.
 * The value stays a "، "-joined string so the rest of the form keeps working with parseKeywords().
 */
export function KeywordInput({ value, onChange, placeholder, label, tone = "default" }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  tone?: "default" | "exclude";
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const words = parseKeywords(value);

  function commit(raw: string) {
    const added = parseKeywords(raw);
    if (!added.length) return;
    onChange(parseKeywords([...words, ...added].join("\n")).join("، "));
    setText("");
  }

  function remove(word: string) {
    onChange(words.filter((item) => item !== word).join("، "));
    inputRef.current?.focus();
  }

  return <div className={`keyword-input ${tone === "exclude" ? "keyword-input-exclude" : ""}`} onClick={() => inputRef.current?.focus()}>
    {words.map((word) => <span className="keyword-chip" key={word}>
      <span dir="auto">{word}</span>
      <button type="button" aria-label={`حذف «${word}»`} onClick={(event) => { event.stopPropagation(); remove(word); }}>×</button>
    </span>)}
    <input
      ref={inputRef}
      value={text}
      aria-label={label}
      placeholder={words.length ? "کلمهٔ بعدی…" : placeholder}
      onChange={(event) => {
        const next = event.target.value;
        // Typing a comma finishes the current word.
        if (/[,،;؛]/.test(next)) commit(next); else setText(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(text); }
        else if (event.key === "Backspace" && !text && words.length) remove(words[words.length - 1]);
      }}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData("text");
        if (/[,،;؛\n]/.test(pasted)) { event.preventDefault(); commit(text + pasted); }
      }}
      onBlur={() => commit(text)}
    />
    {text.trim() && <button type="button" className="keyword-add" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(text)}>+ افزودن</button>}
  </div>;
}
