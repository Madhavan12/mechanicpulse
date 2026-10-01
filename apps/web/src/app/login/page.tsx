"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ email, password });
      // Per the spec's Login -> Job List flow.
      router.push("/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface flex flex-col items-center px-5 pt-20 lg:justify-center lg:pt-0">
      <div className="w-full lg:max-w-[400px] lg:bg-card lg:rounded-2xl lg:p-8 lg:shadow-sm">
        <div className="flex flex-col gap-1 mb-8">
          <h1 className="text-2xl font-bold text-ink">Mechanic Pulse</h1>
          <p className="text-sm text-brass">Log in to manage today&apos;s jobs</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField
            label="Email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <TextField
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="flex justify-end -mt-2">
            <a href="#" className="text-sm text-brass">
              Forgot password?
            </a>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          )}

          <Button type="submit" fullWidth disabled={loading}>
            {loading ? "Logging in…" : "Log In"}
          </Button>
        </form>
      </div>
    </main>
  );
}
