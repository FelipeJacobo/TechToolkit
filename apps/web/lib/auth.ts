export type AuthUser = {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
};

const AUTH_KEY = "aiclaw_auth";

export const saveAuth = (user: AuthUser) => {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
};

export const getAuth = (): AuthUser | null => {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
};

export const clearAuth = () => {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
};

export const isAuthenticated = (): boolean => {
  return getAuth() !== null;
};
