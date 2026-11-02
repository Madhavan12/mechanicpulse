"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { clearSession, createJob, FieldValidationError, getStoredMechanic, getToken } from "@/lib/api";
import type { CreateJobRequest, FieldError } from "../../../../../../packages/shared/types";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";

type Field = FieldError["field"];
type Errors = Partial<Record<Field, string>>;

/** First-pass checks so most mistakes are caught without a round trip. The
 * API re-checks everything and is the authority — see apps/api/src/lib/jobInput.ts. */
function validate(v: { name: string; mobile: string; rego: string; odometer: string }): Errors {
  const errors: Errors = {};
  if (!v.name.trim()) errors.customerName = "Enter the customer's name.";
  if (!/^(\+?61|0)4\d{8}$/.test(v.mobile.replace(/[\s\-()]/g, ""))) {
    errors.customerMobile = "Enter an Australian mobile number, like 0412 345 678.";
  }
  if (!/^[A-Za-z0-9]{1,9}$/.test(v.rego.replace(/\s+/g, ""))) {
    errors.rego = "Enter a rego of up to 9 letters and numbers.";
  }
  if (v.odometer.trim() && !/^\d{1,7}$/.test(v.odometer.trim())) {
    errors.odometerKm = "Odometer must be a whole number of kilometres.";
  }
  return errors;
}

function FieldMessage({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-red -mt-3">
      {message}
    </p>
  );
}

export default function NewJobPage() {
  const router = useRouter();
  const [mechanicName, setMechanicName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [rego, setRego] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [odometer, setOdometer] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setMechanicName(getStoredMechanic()?.name ?? null);
  }, [router]);

  if (!mechanicName) return null;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found = validate({ name, mobile, rego, odometer });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: CreateJobRequest = {
      customerName: name.trim(),
      customerMobile: mobile.trim(),
      rego: rego.trim(),
      ...(make.trim() && { make: make.trim() }),
      ...(model.trim() && { model: model.trim() }),
      ...(odometer.trim() && { odometerKm: Number(odometer.trim()) }),
    };

    setSubmitting(true);
    try {
      await createJob(body);
      // Active Job doesn't exist yet — land on the list, where the new job
      // sits at the top as Not Started. Point this at /jobs/<id> once it does.
      router.push("/jobs");
    } catch (err) {
      if (err instanceof FieldValidationError) setErrors({ [err.field]: err.message });
      else setFormError(err instanceof Error ? err.message : "Could not create the job.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface">
      <AppHeader mechanicName={mechanicName} onBack={() => router.push("/jobs")} onLogout={logout} />

      <div className="px-5 py-6 lg:flex lg:justify-center lg:py-10">
        <form
          onSubmit={onSubmit}
          noValidate
          className="w-full lg:max-w-[480px] lg:bg-card lg:rounded-2xl lg:p-8 lg:shadow-sm flex flex-col gap-4 pb-[34px]"
        >
          <h1 className="text-xl font-bold text-ink">New Job</h1>

          <h2 className="text-sm font-semibold text-brass mt-2">Customer</h2>
          <TextField
            label="Name"
            required
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.customerName}
            aria-describedby={errors.customerName ? "err-name" : undefined}
          />
          <FieldMessage id="err-name" message={errors.customerName} />
          <TextField
            label="Mobile"
            type="tel"
            inputMode="tel"
            required
            autoComplete="off"
            placeholder="0412 345 678"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            aria-invalid={!!errors.customerMobile}
            aria-describedby={errors.customerMobile ? "err-mobile" : undefined}
          />
          <FieldMessage id="err-mobile" message={errors.customerMobile} />

          <h2 className="text-sm font-semibold text-brass mt-2">Vehicle</h2>
          <TextField
            label="Rego"
            required
            autoCapitalize="characters"
            autoComplete="off"
            value={rego}
            onChange={(e) => setRego(e.target.value.toUpperCase())}
            aria-invalid={!!errors.rego}
            aria-describedby={errors.rego ? "err-rego" : undefined}
          />
          <FieldMessage id="err-rego" message={errors.rego} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Make" autoComplete="off" value={make} onChange={(e) => setMake(e.target.value)} />
            <TextField label="Model" autoComplete="off" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <TextField
            label="Odometer (km)"
            inputMode="numeric"
            autoComplete="off"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            aria-invalid={!!errors.odometerKm}
            aria-describedby={errors.odometerKm ? "err-odo" : undefined}
          />
          <FieldMessage id="err-odo" message={errors.odometerKm} />

          {formError && (
            <p role="alert" className="text-sm text-red">
              {formError}
            </p>
          )}

          <div className="flex flex-col gap-3 mt-2">
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? "Creating…" : "Create Job"}
            </Button>
            <Button type="button" variant="outline" fullWidth onClick={() => router.push("/jobs")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
