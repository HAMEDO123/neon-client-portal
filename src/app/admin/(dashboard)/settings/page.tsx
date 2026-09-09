import { Clock, Send, Sparkles } from "lucide-react";
import { saveTimezone } from "@/lib/actions/whatsapp-actions";
import { getTimezone } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { isPushConfigured } from "@/lib/notifications/push";
import { activeTransport, checkWhatsAppConnection, getCloudCredentials } from "@/lib/whatsapp";
import { getWhatsAppConfig as getWorkerConfig } from "@/lib/whatsapp/worker";
import { WhatsAppTest } from "@/components/admin/whatsapp-test";
import { WhatsAppChannelCard } from "@/components/admin/channel-cards";
import { lineStatus } from "@/lib/whatsapp/worker";
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
  const transport = activeTransport();
  const cloud = getCloudCredentials();
  const worker = getWorkerConfig();

  // Only reach out when something is configured — otherwise the page waits on
  // a request that was never going to arrive.
  const connection = transport === "none" ? null : await checkWhatsAppConnection();

  // The linked-number card asks the worker directly, since a QR session has
  // states the transport check does not describe.
  const line = worker ? await lineStatus() : null;
  const linkState = line?.ok
    ? {
        status: line.data.status,
        qrDataUrl: line.data.qrDataUrl,
        pairingCode: line.data.pairingCode,
        phoneNumber: line.data.phoneNumber,
        error: line.data.error ?? null,
      }
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink/50">Integrations and the values the daily jobs run on.</p>
      </div>

      {/* --- Channels ------------------------------------------------------ */}
      <section>
        <h2 className="text-sm font-semibold text-ink">Company channels</h2>
        <p className="mt-1 text-sm text-ink/50">
          Link the studio&apos;s number once, and the portal sends from it — project links, updates and the
          gallery PDF.
        </p>

        {/* One channel, because one is what sends. */}
        <div className="mt-4 max-w-sm">
          <WhatsAppChannelCard workerConfigured={Boolean(worker)} initial={linkState} />
        </div>
      </section>

      {/* --- WhatsApp detail ------------------------------------------------ */}
      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <Send size={16} strokeWidth={2} />
            Sending
          </h2>
          {transport === "none" ? (
            <Badge tone="neutral">Not configured</Badge>
          ) : connection?.ok ? (
            <Badge tone="success">{transport === "cloud" ? "Cloud API" : "Session worker"}</Badge>
          ) : (
            <Badge tone="warning">Unreachable</Badge>
          )}
        </div>

        {transport !== "none" ? (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row
                label="Transport"
                value={
                  transport === "cloud"
                    ? "Meta Cloud API — official, cannot get the number banned"
                    : "whatsapp-web.js session (the Nixora worker)"
                }
              />
              {cloud && <Row label="Phone number ID" value={cloud.phoneNumberId} />}
              {worker && transport === "worker" && <Row label="Worker" value={worker.baseUrl} />}
              {connection?.number && (
                <Row label={transport === "cloud" ? "Sends from" : "Line"} value={connection.number} />
              )}
              <Row
                label="Status"
                value={connection?.detail ?? "Unknown"}
                tone={connection?.ok ? undefined : "text-red-600"}
              />
            </dl>

            <WhatsAppTest disabled={!connection?.ok} />
          </>
        ) : (
          <div className="mt-3 text-sm text-ink/60">
            <p>
              Two ways to send, from the same nexora-whatsapp library. Set either one.
            </p>

            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-ink/40">
              Official Cloud API — recommended
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/[0.04] p-3 text-xs text-ink/70">
{`WHATSAPP_CLOUD_PHONE_NUMBER_ID   from Meta Business
WHATSAPP_CLOUD_ACCESS_TOKEN      a permanent token
WHATSAPP_CLOUD_APP_SECRET        optional, for inbound webhooks`}
            </pre>
            <p className="mt-1.5 text-xs text-ink/45">
              Runs here with nothing else to host, and the number cannot be banned for automation.
            </p>

            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-ink/40">
              Or the existing session worker
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/[0.04] p-3 text-xs text-ink/70">
{`WHATSAPP_WORKER_URL   the Nixora worker's URL
WHATSAPP_WORKER_KEY   its WORKER_API_KEY
WHATSAPP_LINE_ID      "main" for the company line (default)`}
            </pre>
            <p className="mt-1.5 text-xs text-ink/45">
              The worker holds the linked WhatsApp Web session, so nothing is linked again here — but it must be
              reachable from this deployment.
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
