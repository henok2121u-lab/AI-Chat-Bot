import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useLogin } from "../api/hooks";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorNote, Field, Input } from "../components/ui";

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/inbox";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate(from, { replace: true }) });
  }

  return (
    <AuthShell title="Log in to your dashboard">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <ErrorNote error={login.error} />
        <Button type="submit" loading={login.isPending} className="w-full">
          Log in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New here?{" "}
        <Link to="/register" className="font-medium text-brand-700 hover:underline">
          Register your business
        </Link>
      </p>
      {import.meta.env.DEV && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
          Demo: demo@supportbot.test / demo1234
        </p>
      )}
    </AuthShell>
  );
}
