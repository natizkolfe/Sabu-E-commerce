const KEY = "sabu_guest_token";

export function getOrCreateGuestToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem(KEY);
  if (!token || token.length < 24) {
    token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(KEY, token);
  }
  return token;
}
