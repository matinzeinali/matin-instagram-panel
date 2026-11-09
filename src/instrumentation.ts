export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverMissedCommentsOnStartup } = await import("@/lib/comment-recovery");
    void recoverMissedCommentsOnStartup();
    const { startGateFollowups } = await import("@/lib/gate-followup");
    startGateFollowups();
  }
}
