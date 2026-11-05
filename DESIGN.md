# DESIGN.md — پنل متین

## Brief
- **Who:** the owner of a small Instagram business (and the staff they give access to), mostly on a laptop, sometimes a phone, in the middle of a workday — they want to post, answer DMs and leave.
- **The one action:** publish/schedule a post; second: answer messages.
- **Must feel:** calm, legible, trustworthy. **Must not feel:** flashy, "AI dashboard", cramped.
- **Concrete-world reference:** a work notebook / ledger on a desk — paper, ink, one red pen for what matters.

## Direction: «دفتر روشن» (light notebook) — chosen 2026-11-05
- **Surface:** warm paper `--paper #F6F3EC`, sheets `--sheet #FFFDF8`, rules `--rule #E4DED2`.
- **Ink:** `--ink #1E2321`, secondary `--ink-soft #5B615D`, faint `--ink-faint #8A8F8A`.
- **Ink green (primary, active, links):** `--green #1F4D3F`, tint `--green-tint #E6EEE9`.
- **Red pen (coral — only for what needs attention):** `--coral #E2674A` — unread counts, the one main CTA (publish), destructive confirmation. Never decoration.
- **Status:** ok `#2E7D5B`, warn `#9A6A12` on `#FBF3DF`, error `#B3412E` on `#FCEDEA`.

## Type
- UI/body: **Vazirmatn** 15px, line-height 1.85. Minimum text size 12px.
- Second voice: **Markazi Text** (Arabic-script serif) for page titles only — the "notebook heading". Nowhere else.
- No letter-spacing on Persian. Persian digits in copy (`toLocaleString("fa-IR")`). Latin handles/IDs get `dir="ltr"`.

## Layout rules
- Shell: thin header (brand, profile switcher, user), a plain list sidebar (no card, no icons in tinted squares), content column.
- One sheet per task; no cards inside cards. Lists use ruled rows, not boxed rows.
- No eyebrow labels, no fake status indicators (nothing says "connected" unless it was checked).
- Technical setup messages (API keys, env files) are only shown to admins.

## Motion
- Only hover/focus colour transitions and the loading spinner. Respect `prefers-reduced-motion`.
