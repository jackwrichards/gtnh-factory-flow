"use client";

import { ChevronDown, LogOut, ShieldCheck, User, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthForm, useCommunityUser } from "./auth";

/**
 * Top-right account control, shared by the planner and community headers:
 * a Sign in button when logged out, a username menu when logged in.
 */
export function AccountMenu() {
  const { user, isLoading, setUser, signOut } = useCommunityUser();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isAuthOpen, setAuthOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [isMenuOpen]);

  if (isLoading) {
    return <div className="h-7 w-20 animate-pulse rounded bg-surface-sunken" aria-hidden />;
  }

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-raised"
        >
          <User className="h-3.5 w-3.5" /> Sign in
        </button>
        {isAuthOpen ? (
          <div
            className="fixed inset-0 z-[110] grid place-items-center bg-neutral-950/50 p-4"
            onClick={() => setAuthOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded border border-line-strong bg-surface p-4 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="mb-1 text-base font-semibold">Community account</h2>
              <p className="mb-3 text-xs text-fg-muted">
                Just a username and password — needed to share plans and manage your posts.
              </p>
              <AuthForm
                onSignedIn={(signedInUser) => {
                  setUser(signedInUser);
                  setAuthOpen(false);
                }}
              />
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={isMenuOpen}
        className="inline-flex h-7 items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 text-sm font-medium text-fg hover:bg-surface-raised"
      >
        {user.isAdmin ? (
          <ShieldCheck className="h-3.5 w-3.5 text-cyan-500" />
        ) : (
          <User className="h-3.5 w-3.5" />
        )}
        <span className="max-w-32 truncate">{user.username}</span>
        <ChevronDown className="h-3 w-3 text-fg-muted" />
      </button>
      {isMenuOpen ? (
        <div className="absolute right-0 top-9 z-[110] min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
          <Link
            href="/community?mine=1"
            onClick={() => setMenuOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-raised"
          >
            <Users className="h-3.5 w-3.5 text-fg-muted" /> My posts
          </Link>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-raised"
          >
            <LogOut className="h-3.5 w-3.5 text-fg-muted" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
