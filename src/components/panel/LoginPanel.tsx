"use client";

import { useState } from "react";

type AuthUser = { id: string; username: string; role: "admin" | "user"; profileId?: string; accountId?: string };

export function LoginPanel({ setupRequired, onSuccess }: { setupRequired: boolean; onSuccess: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (setupRequired && password !== confirmPassword) return setError("گذرواژه و تکرار آن یکسان نیستند.");
    setBusy(true);
    try {
      const response = await fetch(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ورود انجام نشد.");
      onSuccess(result.user as AuthUser);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ارتباط با پنل برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand">متین</div>
      <h1>{setupRequired ? "ساخت حساب مدیر" : "ورود به پنل"}</h1>
      <p className="muted">{setupRequired ? "اولین بار است که پنل را باز می‌کنی. نام کاربری و گذرواژهٔ مدیر را تعیین کن؛ این صفحه فقط یک‌بار نمایش داده می‌شود." : "با نام کاربری و گذرواژه‌ای که مدیر پنل به تو داده وارد شو."}</p>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <label className="compose-label">نام کاربری<input className="field" dir="ltr" autoComplete="username" autoFocus minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label className="compose-label">گذرواژه<input className="field" dir="ltr" type="password" autoComplete={setupRequired ? "new-password" : "current-password"} minLength={setupRequired ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required />{setupRequired && <span className="field-hint">حداقل ۱۲ نویسه</span>}</label>
        {setupRequired && <label className="compose-label">تکرار گذرواژه<input className="field" dir="ltr" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}
        {error && <p role="alert" className="error-note">{error}</p>}
        <button className="button-primary w-full" disabled={busy}>{busy ? "در حال بررسی…" : setupRequired ? "ساخت حساب و ورود" : "ورود"}</button>
      </form>
      <p className="auth-footnote">گذرواژه‌ها رمزنگاری‌شده ذخیره می‌شوند و هیچ‌کس، حتی مدیر، آن‌ها را نمی‌بیند.</p>
    </section>
  </main>;
}
