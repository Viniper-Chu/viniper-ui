export function engineIdForSession(session) {
  return session?.engineId === "claude-code" ? "claude-code" : "viniper";
}

export function isEmptyConversationSession(session) {
  return Array.isArray(session?.messages) && session.messages.length === 0;
}

export function preferredEmptySession(sessions, engineId) {
  return sessions.find((session) => engineIdForSession(session) === engineId && isEmptyConversationSession(session)) ?? null;
}

export function preferredStartupSession(sessions, activeSessionId) {
  const active = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  if (!active) return null;
  return preferredEmptySession(sessions, engineIdForSession(active)) ?? active;
}
