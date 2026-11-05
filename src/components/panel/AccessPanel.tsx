"use client";

import { useCallback, useEffect, useState } from "react";
import type { SocialAccount } from "./types";
import { accountOptionLabel } from "./types";

type UserRow = { id: string; username: string; role: "admin" | "user"; createdAt: string; profileId?: string; accountId?: string };
type Props = { user: { id: string; username: string; role: "admin" | "user" }; profileId: string; accounts: SocialAccount[] };

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export function AccessPanel({ user, profileId, accounts }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAccountId, setNewAccountId] = useState("");
  const [assignmentChoices, setAssignmentChoices] = useState<Record<string, string>>({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [replacementPassword, setReplacementPassword] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    if (user.role !== "admin") return;
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, `دریافت کاربران ناموفق بود (${response.status}).`));
      const data = await response.json();
      setUsers(data.users || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت کاربران ناموفق بود.");
    }
  }, [user.role]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (!accounts.some((account) => (account._id || account.id) === newAccountId)) setNewAccountId(accounts[0]?._id || accounts[0]?.id || "");
    setAssignmentChoices((current) => {
      const next = { ...current };
      for (const row of users) if (!(row.id in next)) next[row.id] = row.accountId || "";
      return next;
    });
  }, [accounts, newAccountId, users]);

  async function changeOwnPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: replacementPassword }),
      });
      if (!response.ok) throw new Error(await readError(response, "تغییر گذرواژه انجام نشد."));
      setMessage("گذرواژه عوض شد. برای امنیت، از حساب خارج شدی؛ با گذرواژهٔ تازه وارد شو.");
      setCurrentPassword(""); setReplacementPassword("");
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تغییر گذرواژه انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, profileId, accountId: newAccountId }),
      });
      if (!response.ok) throw new Error(await readError(response, `ساخت حساب ناموفق بود (${response.status}).`));
      setNewUsername(""); setNewPassword(""); setMessage("حساب کاربری ساخته شد.");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ساخت حساب ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function assignAccount(target: UserRow) {
    const accountId = assignmentChoices[target.id] || "";
    if (!profileId || !accountId) return setError("ابتدا یک حساب متصل از فهرست انتخاب کن.");
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}/account`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId, accountId }),
      });
      if (!response.ok) throw new Error(await readError(response, `تغییر حساب ناموفق بود (${response.status}).`));
      setAssignmentChoices((current) => ({ ...current, [target.id]: accountId }));
      setMessage(`حساب متصل ${target.username} تغییر کرد؛ نشست‌های قبلی او بسته شدند.`);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تغییر حساب ناموفق بود.");
    } finally { setBusy(false); }
  }

  async function resetPassword(target: UserRow) {
    const password = resetPasswords[target.id] || "";
    if (password.length < 12) return setError("گذرواژهٔ تازه باید حداقل ۱۲ نویسه داشته باشد.");
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}/password`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword: password }),
      });
      if (!response.ok) throw new Error(await readError(response, `بازنشانی گذرواژه ناموفق بود (${response.status}).`));
      setResetPasswords((current) => ({ ...current, [target.id]: "" }));
      if (target.id === user.id) {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.reload();
        return;
      }
      setMessage(`گذرواژهٔ ${target.username} عوض شد و نشست‌های قبلی‌اش بسته شدند.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "بازنشانی گذرواژه ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  const accountLabel = (id?: string) => {
    const account = accounts.find((item) => (item._id || item.id) === id);
    return account ? (account.username ? `@${account.username}` : account.displayName || account.platform || id) : id ? "حسابی خارج از این پروفایل" : "بدون حساب";
  };
  const accountOptions = accounts.map((account) => { const id = account._id || account.id || ""; return <option key={id} value={id}>{accountOptionLabel(account)}</option>; });

  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    {(error || message) && <div className="xl:col-span-2">{error ? <p role="alert" className="error-note">{error}</p> : <p role="status" className="success-note">{message}</p>}</div>}

    {user.role === "admin" && <section className="panel-card">
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="section-title">کاربران پنل</h2><button className="button-quiet" disabled={busy} onClick={() => void loadUsers()}>تازه‌سازی</button></div>
      {users.length ? <ul className="plain-list">{users.map((row) => <li className="list-row" key={row.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div><strong dir="ltr">{row.username}</strong>{row.id === user.id && <span className="inline-hint">(خودت)</span>}<div className="account-id">{row.role === "admin" ? "مدیر · به همهٔ حساب‌ها دسترسی دارد" : `دسترسی به ${accountLabel(row.accountId)}`} · ساخته‌شده {new Date(row.createdAt).toLocaleDateString("fa-IR")}</div></div>
          <span className={`badge ${row.role === "admin" ? "" : "badge-off"}`}>{row.role === "admin" ? "مدیر" : "کاربر"}</span>
        </div>
        <details className="mt-2">
          <summary className="edit-toggle">تغییر دسترسی یا گذرواژه</summary>
          <div className="automation-edit">
            {row.role === "user" && <label className="compose-label">حساب مجاز<div className="inline-save"><select className="field" value={assignmentChoices[row.id] || ""} onChange={(event) => setAssignmentChoices((current) => ({ ...current, [row.id]: event.target.value }))}><option value="">انتخاب حساب…</option>{accountOptions}</select><button className="button-secondary" disabled={busy || !assignmentChoices[row.id] || assignmentChoices[row.id] === row.accountId} onClick={() => void assignAccount(row)}>ذخیره</button></div></label>}
            <label className="compose-label">گذرواژهٔ تازه<div className="inline-save"><input className="field" dir="ltr" type="password" autoComplete="new-password" minLength={12} placeholder="حداقل ۱۲ نویسه" value={resetPasswords[row.id] || ""} onChange={(event) => setResetPasswords((current) => ({ ...current, [row.id]: event.target.value }))} /><button className="button-secondary" disabled={busy || (resetPasswords[row.id] || "").length < 12} onClick={() => void resetPassword(row)}>تعیین</button></div><span className="field-hint">با تغییر گذرواژه، این کاربر از همهٔ دستگاه‌ها خارج می‌شود.</span></label>
          </div>
        </details>
      </li>)}</ul> : <p className="empty-note">{error ? "فهرست کاربران بارگذاری نشد." : "هنوز کاربری نیست."}</p>}
    </section>}

    <div className="grid gap-6">
      {user.role === "admin" && <section className="panel-card compose-panel">
        <h2 className="section-title">همکار تازه</h2>
        <p className="muted mt-1 mb-4">همکار فقط به همان یک حسابی که انتخاب می‌کنی دسترسی خواهد داشت.</p>
        <form onSubmit={addUser}>
          <label className="compose-label">نام کاربری<input className="field" dir="ltr" autoComplete="off" minLength={3} maxLength={32} value={newUsername} onChange={(event) => setNewUsername(event.target.value)} required /></label>
          <label className="compose-label">گذرواژهٔ اولیه<input className="field" dir="ltr" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="field-hint">حداقل ۱۲ نویسه؛ همکار بعد از ورود می‌تواند عوضش کند.</span></label>
          <label className="compose-label">حساب مجاز<select className="field" value={newAccountId} onChange={(event) => setNewAccountId(event.target.value)} required disabled={!accounts.length}><option value="">{accounts.length ? "انتخاب حساب…" : "اول یک حساب اجتماعی وصل کن"}</option>{accountOptions}</select></label>
          <div className="compose-submit"><button className="button-primary" disabled={busy || !profileId || !accounts.length || !newAccountId}>ساخت حساب همکار</button></div>
        </form>
      </section>}

      <section className="panel-card compose-panel">
        <h2 className="section-title">گذرواژهٔ خودت</h2>
        <p className="muted mt-1 mb-4">واردشده با <strong dir="ltr">{user.username}</strong>. بعد از تغییر، دوباره وارد می‌شوی.</p>
        <form onSubmit={changeOwnPassword}>
          <label className="compose-label">گذرواژهٔ فعلی<input className="field" dir="ltr" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label className="compose-label">گذرواژهٔ تازه<input className="field" dir="ltr" type="password" autoComplete="new-password" minLength={12} value={replacementPassword} onChange={(event) => setReplacementPassword(event.target.value)} required /><span className="field-hint">حداقل ۱۲ نویسه</span></label>
          <div className="compose-submit"><button className="button-secondary" disabled={busy}>تغییر گذرواژه</button></div>
        </form>
      </section>
    </div>
  </div>;
}
