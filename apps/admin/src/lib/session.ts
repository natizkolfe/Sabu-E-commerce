const KEY = "sabu_admin_session";

export type AdminSession = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    permissions: string[];
    roles: string[];
  };
};

export function loadSession(): AdminSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function saveSession(session: AdminSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
