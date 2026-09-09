import { Clock, MessageCircle, Sparkles } from "lucide-react";
import { saveTimezone } from "@/lib/actions/whatsapp-actions";
import { getTimezone } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { isPushConfigured } from "@/lib/notifications/push";
import { getWhatsAppConfig, whatsAppHealth, whatsAppLineStatus } from "@/lib/whatsapp/worker";
import { WhatsAppTest } from "@/components/admin/whatsapp-test";
import { SaveButton } from "@/components/admin/form-buttons";
import { Badge } from "@/components/ui/badge";

// Integrations and the settings the platform reads at runtime, in one place
// so it is obvious what is wired up and what is still missing.

const TIMEZONES = [
  "Asia/Amman",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Africa/Cairo",
  "Europe/Istanbul",
  "Europe/London",
  "UTC",
];

export default async function AdminSettingsPage() {
  const timezone = await getTimezone();
  const whatsapp = getWhatsAppConfig();

  // Only reach out when it is configured — otherwise the page waits on a
  // request that was never going to arrive.
  const health = whatsapp ? await whatsAppHealth() : null;
  const line = whatsapp && health?.ok ? await whatsAppLineStatus() : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink/50">Integrations and the values the daily jobs run on.</p>
      </div>

      {/* --- WhatsApp ----------------------------------------------------- */}
      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <MessageCircle size={16} strokeWidth={2} />
            WhatsApp
          </h2>
          {whatsapp ? (
            health?.ok ? (
              <Badge tone="success">Connected</Badge>
            ) : (
              <Badge tone="warning">Unreachable</Badge>
            )
          ) : (
            <Badge tone="neutral">Not configured</Badge>
          )}
        </div>

        {whatsapp ? (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row label="Worker" value={whatsapp.baseUrl} />
              <Row label="Line" value={whatsapp.line === "main" ? "Company line (main)" : whatsapp.line} />
              {health?.ok && <Row label="Company" value={health.data.companyId} />}
              {health && !health.ok && <Row label="Error" value={health.error} tone="text-red-600" />}
              {line && !line.ok && <Row label="Line status" value={line.error} tone="text-amber-700" />}
              {line?.ok && <Row label="Line status" value={describeLine(line.data)} />}
            </dl>

            <WhatsAppTest disabled={!health?.ok} />
          </>
        ) : (
          <div className="mt-3 text-sm text-ink/60">
            <p>
              This portal sends through the same whatsapp-web.js worker the Nixora app already runs — it holds the
              linked session, so nothing needs to be linked again here.
            </p>
            <p className="mt-3 text-xs text-ink/45">Set these on the server and the panel above goes live:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/[0.04] p-3 text-xs text-ink/70">
{`WHATSAPP_WORKER_URL   the worker's URL, e.g. https://wa.example.com
WHATSAPP_WORKER_KEY   its WORKER_API_KEY
WHATSAPP_LINE_ID      "main" for the company line (default)`}
            </pre>
            <p className="mt-2 text-xs text-ink/45">
              The worker must be reachable from this deployment — on the same network, or exposed through the
              tunnel it already uses.
            </p>
          </div>
        )}
      </section>

      {/* --- Timezone ----------------------------------------------------- */}
      <section className="glass rounded-2xl p-6">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Clock size={16} strokeWidth={2} />
          Company timezone
        </h2>
        <p className="mt-1 text-sm text-ink/50">
          Decides which day a task belongs to and when the 4:00 PM notifier runs. Stored in the database, so
          changing it needs no redeploy.
        </p>

        <form action={saveTimezone} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-48">
            <span className="mb-1 block text-xs font-medium text-ink/50">Timezone</span>
            <select
              name="timezone"
              defaultValue={timezone}
              className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
            >
              {[...new Set([timezone, ...TIMEZONES])].map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <SaveButton label="Save timezone" />
        </form>
      </section>

      {/* --- Everything else that depends on a key ------------------------ */}
      <section className="glass rounded-2xl p-6">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles size={16} strokeWidth={2} />
          Other integrations
        </h2>

        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <Integration
            name="AI assistant & receipt reading"
            configured={isAiConfigured()}
            hint="ANTHROPIC_API_KEY — powers the manager's chat assistant and reads receipt photos."
          />
          <Integration
            name="Push notifications"
            configured={isPushConfigured()}
            hint="VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — without them, notifications stay in-app."
          />
        </dl>
      </section>
    </div>
  );
}

function describeLine(status: unknown) {
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    const state = record.state ?? record.status ?? record.connection;
    if (typeof state === "string") return state;
  }
  return "Linked";
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink/40">{label}</dt>
      <dd className={`mt-0.5 break-all text-sm ${tone ?? "text-ink/70"}`}>{value}</dd>
    </div>
  );
}

function Integration({ name, configured, hint }: { name: string; configured: boolean; hint: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{name}</p>
        <p className="text-xs text-ink/45">{hint}</p>
      </div>
      <Badge tone={configured ? "success" : "neutral"}>{configured ? "Configured" : "Not set"}</Badge>
    </div>
  );
}
