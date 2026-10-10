import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useRegister } from "../api/hooks";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorNote, Field, Input, Select } from "../components/ui";

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: "", businessType: "RESTAURANT", name: "", email: "", password: "" });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    // New businesses land on Knowledge to fill in what the bot should know.
    register.mutate(form, { onSuccess: () => navigate("/knowledge", { replace: true }) });
  }

  return (
    <AuthShell title="Register your business">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name">{(id) => <Input id={id} required minLength={2} value={form.businessName} onChange={set("businessName")} />}</Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={form.businessType} onChange={set("businessType")}>
                <option value="RESTAURANT">Restaurant / café</option>
                <option value="CLINIC">Clinic</option>
                <option value="SALON">Salon</option>
                <option value="OTHER">Other</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Your name">{(id) => <Input id={id} required autoComplete="name" value={form.name} onChange={set("name")} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={set("email")} />}</Field>
        <Field label="Password" hint="At least 8 characters.">
          {(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} />}
        </Field>
        <ErrorNote error={register.error} />
        <Button type="submit" loading={register.isPending} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
