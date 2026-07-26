"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  fetchCurrentUser,
  loginCommunityUser,
  logoutCommunityUser,
  registerCommunityUser,
} from "@/lib/community/client";
import type { CommunityUser } from "@/lib/community/types";

/** Session state shared by the share dialog and the community page. */
export function useCommunityUser() {
  const [user, setUser] = useState<CommunityUser>();
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await logoutCommunityUser();
    setUser(undefined);
  }, []);

  return { user, isLoading, refresh, setUser, signOut };
}

/**
 * Inline username+password form covering both sign in and account creation.
 * Deliberately minimal: no email, no reset — pick a name, pick a password.
 */
export function AuthForm({ onSignedIn }: { onSignedIn: (user: CommunityUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [isBusy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const user =
        mode === "login"
          ? await loginCommunityUser(username, password)
          : await registerCommunityUser(username, password);
      onSignedIn(user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="auth-mode"
            checked={mode === "login"}
            onChange={() => setMode("login")}
          />
          Sign in
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="auth-mode"
            checked={mode === "register"}
            onChange={() => setMode("register")}
          />
          Create account
        </label>
      </div>
      <input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Username"
        autoComplete="username"
        maxLength={24}
        className="w-full rounded border border-line-strong bg-surface-sunken px-2 py-1.5 text-sm"
      />
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        maxLength={128}
        className="w-full rounded border border-line-strong bg-surface-sunken px-2 py-1.5 text-sm"
      />
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={isBusy || username.trim().length < 3 || password.length < 6}
        className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
