import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, refreshTokens, setSessionExpiredHandler } from "@/api/client";
import { isApiError } from "@/api/errors";
import { isLanguage } from "@/i18n";
import { useLanguage } from "@/i18n/provider";
import { disablePush, forgetPush } from "@/features/push/push";

import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./token-store";
import type { AuthResponse, ProfileUpdate, RegisterInput, User } from "./types";

/** - `loading`: reading the stored session at start-up;
 * - `offline`: a session is stored but the server could not be reached (kept, retry);
 * - `signedOut` / `signedIn`. */
export type AuthStatus = "loading" | "offline" | "signedOut" | "signedIn";

type AuthState = {
  status: AuthStatus;
  user: User | null;
  /** Why the student was signed out without asking (shown once on the sign-in screen). */
  notice: "sessionExpired" | "passwordChanged" | "accountDeleted" | null;
  clearNotice: () => void;
  retry: () => void;
  signIn: (mobileNumber: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (changes: ProfileUpdate) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Deletes (anonymises) this account on the server, then ends the session here. Irreversible. */
  deleteAccount: (currentPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready: languageReady, language, setLanguage } = useLanguage();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<AuthState["notice"]>(null);
  const [attempt, setAttempt] = useState(0);
  // The latest UI language for async callbacks, without re-running the start-up effect.
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const endSession = useCallback((reason: AuthState["notice"]) => {
    setUser(null);
    setNotice(reason);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => endSession("sessionExpired"));
    return () => setSessionExpiredHandler(null);
  }, [endSession]);

  // Start-up: a stored refresh token → new pair → profile. The phone's language choice
  // wins over the account's (it was changed here, maybe while offline) and is synced.
  useEffect(() => {
    if (!languageReady) return;
    let active = true;
    void (async () => {
      try {
        if (!(await getRefreshToken()) || !(await refreshTokens())) {
          if (active) setStatus("signedOut");
          return;
        }
        let me = await api<User>("/me/");
        if (me.preferred_language !== languageRef.current) {
          me = await api<User>("/me/", { method: "PATCH", body: { preferred_language: languageRef.current } }).catch(() => me);
        }
        if (!active) return;
        setUser(me);
        setStatus("signedIn");
      } catch (error) {
        if (!active) return;
        // A refused refresh already cleared the tokens (→ signed out). Anything else —
        // offline, a server error, throttling — keeps the stored session for a retry.
        if (isApiError(error) && error.code === "session_expired") setStatus("signedOut");
        else setStatus("offline");
      }
    })();
    return () => {
      active = false;
    };
  }, [languageReady, attempt]);

  // A fresh sign-in adopts the account's language (it follows the student across phones).
  const startSession = useCallback(
    async (response: AuthResponse) => {
      await saveTokens(response);
      if (isLanguage(response.user.preferred_language) && response.user.preferred_language !== languageRef.current) {
        await setLanguage(response.user.preferred_language);
      }
      setUser(response.user);
      setNotice(null);
      setStatus("signedIn");
    },
    [setLanguage],
  );

  const signIn = useCallback(
    async (mobileNumber: string, password: string) => {
      const response = await api<AuthResponse>("/auth/login/", {
        method: "POST",
        body: { mobile_number: mobileNumber, password },
        auth: false,
      });
      await startSession(response);
    },
    [startSession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const response = await api<AuthResponse>("/auth/register/", {
        method: "POST",
        body: { ...input, preferred_language: languageRef.current },
        auth: false,
      });
      await startSession(response);
    },
    [startSession],
  );

  const signOut = useCallback(async () => {
    try {
      if (!getAccessToken()) await refreshTokens(); // so the calls below are authenticated
      await disablePush(); // this phone stops getting this student's notifications
      const refresh = await getRefreshToken();
      if (refresh) await api("/auth/logout/", { method: "POST", body: { refresh } });
    } catch {
      // Offline or already invalid: the tokens are removed from this phone anyway.
    }
    await clearTokens();
    endSession(null);
  }, [endSession]);

  const updateProfile = useCallback(async (changes: ProfileUpdate) => {
    const next = await api<User>("/me/", { method: "PATCH", body: changes });
    setUser(next);
    return next;
  }, []);

  // The server bumps auth_version: every token (this phone's too) stops working at once.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api("/auth/password/change/", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
      });
      await clearTokens();
      endSession("passwordChanged");
    },
    [endSession],
  );

  // The server anonymises the account and ends every session; this phone forgets it and stops push.
  const deleteAccount = useCallback(
    async (currentPassword: string) => {
      await api("/auth/account/delete/", { method: "POST", body: { current_password: currentPassword } });
      await forgetPush().catch(() => undefined);
      await clearTokens();
      endSession("accountDeleted");
    },
    [endSession],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      notice,
      clearNotice: () => setNotice(null),
      retry: () => {
        setStatus("loading");
        setAttempt((n) => n + 1);
      },
      signIn,
      register,
      signOut,
      updateProfile,
      changePassword,
      deleteAccount,
    }),
    [status, user, notice, signIn, register, signOut, updateProfile, changePassword, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
