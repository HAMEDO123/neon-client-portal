"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions/auth-actions";
import { buttonClasses } from "@/components/ui/buttons";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction} className="glass-strong flex w-full max-w-sm flex-col gap-5 rounded-2xl p-8">
      <div>
        <span className="text-gradient-neon text-lg font-bold">NEON</span>
        <h1 className="mt-2 text-lg font-semibold text-ink">Team Sign In</h1>
        <p className="mt-1 text-sm text-ink/50">Sign in to manage client projects.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink/70">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className={buttonClasses("primary", "md", "w-full")}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
