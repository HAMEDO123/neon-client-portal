"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, FileDown, Loader2, Share } from "lucide-react";
import { useI18n } from "@/lib/client-i18n";

// "Download the gallery as PDF" on the client's page, made to work on a phone
// (2026-11-25: "it takes so long and then it takes me to a web page and does
// not download anything").
//
// A plain link left the phone on a blank page for as long as the document took
// to make, and then handed the file to whatever browser the client was in — an
// app's built-in one often does nothing with it. So the page fetches the PDF
// itself, saying that it is being prepared, and then:
//
// - **on an iPhone or iPad** offers "Save the PDF", which opens the share sheet
//   (Save to Files, WhatsApp, Mail…). The share sheet has to come from a tap, and
//   the tap that started a minute's wait no longer counts, hence the second tap;
// - **anywhere else** saves it straight away;
// - and always offers "Open the PDF" as well, the server's copy shown in the
//   browser, for a browser that will do neither.
//
// The project PDF in the Download Center uses it too (`label`, and `tone`
// "dark" for that section's dark band).

type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "ready"; file: File; url: string }
  | { kind: "saved"; url: string }
  | { kind: "failed" };

function appleTouch() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function saveBlob(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function GalleryPdfButton({
  href,
  label = "Download the gallery as PDF",
  tone = "light",
}: {
  href: string;
  label?: string;
  tone?: "light" | "dark";
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // The file is held in memory only while it is offered.
  const held = phase.kind === "ready" || phase.kind === "saved" ? phase.url : null;
  useEffect(() => {
    if (!held) return;
    return () => URL.revokeObjectURL(held);
  }, [held]);

  async function prepare() {
    if (phase.kind === "preparing") return;
    setPhase({ kind: "preparing" });
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(String(response.status));
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "Gallery.pdf";
      const file = new File([await response.blob()], name, { type: "application/pdf" });
      const url = URL.createObjectURL(file);
      if (appleTouch() && navigator.canShare?.({ files: [file] })) {
        setPhase({ kind: "ready", file, url });
      } else {
        saveBlob(url, name);
        setPhase({ kind: "saved", url });
      }
    } catch {
      setPhase({ kind: "failed" });
    }
  }

  async function share(file: File) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch {
      // Closing the share sheet is not a failure: the button stays for another go.
    }
  }

  const dark = tone === "dark";
  const button = dark
    ? "inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-white/90 disabled:opacity-80"
    : "inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white/70 px-5 py-2.5 text-sm font-medium text-ink/70 transition-colors hover:border-cyan-strong hover:text-cyan-strong disabled:opacity-70";
  const quiet = dark ? "text-white/60" : "text-ink/55";
  const align = dark ? "items-center" : "items-center sm:items-start";
  const open = (
    <a href={`${href}?inline=1`} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 text-xs font-medium underline ${quiet}`}>
      <ExternalLink size={13} />
      {t("Open the PDF")}
    </a>
  );

  if (phase.kind === "ready") {
    return (
      <div className={`flex flex-col gap-2 ${align}`}>
        <button type="button" onClick={() => share(phase.file)} className={dark ? button : `${button} border-cyan-strong text-cyan-strong`}>
          <Share size={16} strokeWidth={1.75} />
          {t("Save the PDF")}
        </button>
        {open}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${align}`}>
      <button type="button" onClick={prepare} disabled={phase.kind === "preparing"} className={button}>
        {phase.kind === "preparing" ? (
          <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
        ) : phase.kind === "saved" ? (
          <Check size={16} strokeWidth={1.75} />
        ) : (
          <FileDown size={16} strokeWidth={1.75} />
        )}
        {phase.kind === "preparing" ? t("Preparing your PDF…") : phase.kind === "saved" ? t("Downloaded") : t(label)}
      </button>
      {phase.kind === "preparing" && <p className={`text-xs ${quiet}`}>{t("A large gallery can take up to a minute.")}</p>}
      {phase.kind === "failed" && <p className={`text-xs ${dark ? "text-red-300" : "text-red-700"}`}>{t("The PDF couldn't be made. Try again.")}</p>}
      {(phase.kind === "saved" || phase.kind === "failed") && open}
    </div>
  );
}
