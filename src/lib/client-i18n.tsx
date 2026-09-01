"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Lightweight i18n for the public client page: English strings are the keys,
// Arabic lives in one dictionary. The choice persists per-browser and flips
// the whole page to RTL. First visit follows the browser language.
type Lang = "en" | "ar";

const AR: Record<string, string> = {
  // Nav / sections
  "Overview": "نظرة عامة",
  "Gallery": "المعرض",
  "Drawings": "المخططات",
  "Materials": "المواد",
  "Furniture": "الأثاث",
  "BOQ": "جدول الكميات",
  "Pricing": "التسعير",
  "Documents": "المستندات",
  "Approvals": "الموافقات",
  "Feedback": "الملاحظات",
  "Handover": "التسليم",
  "Project Sections": "أقسام المشروع",
  "Close Menu": "إغلاق القائمة",

  // Welcome + hero
  "Welcome to your project": "أهلًا بك في مشروعك",
  "Designed by NEON": "بتصميم NEON",
  "Explore Project": "استكشف المشروع",
  "Delivery": "التسليم",
  "Presentation Mode": "وضع العرض التقديمي",

  // Pipeline statuses
  "Draft": "مسودة",
  "Internal Review": "مراجعة داخلية",
  "Sent to Client": "أُرسل للعميل",
  "Client Reviewing": "قيد مراجعة العميل",
  "Changes Requested": "طُلبت تعديلات",
  "Approved": "معتمد",
  "Execution": "قيد التنفيذ",
  "Completed": "مكتمل",
  "Archived": "مؤرشف",

  // Overview
  "Discover": "اكتشف",
  "Project Overview": "نظرة عامة على المشروع",
  "Client": "العميل",
  "Location": "الموقع",
  "Area": "المساحة",
  "Design Scope": "نطاق التصميم",
  "Spaces": "المساحات",
  "{n} spaces": "{n} مساحات",
  "To be confirmed": "سيتم تأكيده لاحقًا",

  // Journey timeline
  "Project Journey": "رحلة المشروع",
  "{n}% Complete": "اكتمل {n}٪",
  "Concept": "الفكرة",
  "Design Development": "تطوير التصميم",
  "3D Visualization": "التصوّر ثلاثي الأبعاد",
  "Technical Drawings": "المخططات التنفيذية",
  "Execution Pricing": "تسعير التنفيذ",
  "Final Approval": "الموافقة النهائية",

  // Gallery
  "Explore": "استكشف",
  "Design Gallery": "معرض التصاميم",
  "Every space, rendered in detail. Tap any image to view it fullscreen.": "كل مساحة، مُصوَّرة بالتفصيل. اضغط أي صورة لعرضها بملء الشاشة.",
  "Renders coming soon": "الصور قادمة قريبًا",
  "The design gallery will appear here once NEON uploads the first renders.": "سيظهر معرض التصاميم هنا فور رفع NEON لأولى الصور.",

  // Drawings
  "Review": "راجع",
  "Architectural, ceiling, electrical, HVAC, plumbing, and joinery documentation — organized and ready to review.": "مخططات معمارية وأسقف وكهرباء وتكييف وصحية ونجارة — منظمة وجاهزة للمراجعة.",
  "Drawings in progress": "المخططات قيد الإعداد",
  "Technical drawings will appear here once released by the design team.": "ستظهر المخططات التنفيذية هنا فور اعتمادها من فريق التصميم.",
  "All": "الكل",
  "View": "عرض",
  "Download": "تنزيل",
  "Revision History": "سجل المراجعات",
  "Current": "الحالية",

  // Materials
  "Material & Finish Board": "لوحة المواد والتشطيبات",
  "The materials, finishes, and surfaces selected for your space.": "المواد والتشطيبات والأسطح المختارة لمساحتك.",
  "Material board coming soon": "لوحة المواد قادمة قريبًا",
  "Selected materials and finishes will appear here.": "ستظهر المواد والتشطيبات المختارة هنا.",
  "Brand": "الماركة",
  "Model": "الموديل",
  "Color": "اللون",
  "Finish": "التشطيب",
  "Supplier": "المورّد",
  "Est. Quantity": "الكمية التقديرية",
  "Reference": "المرجع",
  "Price": "السعر",
  "Used in: {s}": "مستخدم في: {s}",

  // Furniture
  "Furniture & Product Schedule": "جدول الأثاث والمنتجات",
  "Every piece specified for your project, ready for procurement.": "كل قطعة محددة لمشروعك، جاهزة للتوريد.",
  "Furniture schedule coming soon": "جدول الأثاث قادم قريبًا",
  "Selected furniture and products will appear here.": "سيظهر الأثاث والمنتجات المختارة هنا.",
  "Qty": "الكمية",

  // BOQ
  "Quantities & BOQ": "الكميات وجدول الكميات",
  "A complete breakdown of quantities and specifications for execution.": "تفصيل كامل للكميات والمواصفات للتنفيذ.",
  "BOQ will be available once finalized": "سيتوفر جدول الكميات فور اكتماله",
  "Quantities and specifications will appear here once the take-off is complete.": "ستظهر الكميات والمواصفات هنا فور اكتمال الحصر.",
  "Search items…": "ابحث عن بند…",
  "Item": "البند",
  "Category": "الفئة",
  "Quantity": "الكمية",
  "Est. Cost": "التكلفة التقديرية",
  "Estimated Total": "الإجمالي التقديري",
  "Used in:": "مستخدم في:",
  "Drawing:": "المخطط:",

  // Pricing
  "Approve": "اعتمد",
  "Execution Proposal": "عرض التنفيذ",
  "A transparent breakdown of the investment required to bring this project to life.": "تفصيل شفاف للاستثمار المطلوب لإخراج هذا المشروع إلى النور.",
  "A detailed cost breakdown is available on request.": "التفصيل الكامل للتكاليف متاح عند الطلب.",
  "Optional Items": "بنود اختيارية",
  "Total Project Cost": "التكلفة الإجمالية للمشروع",
  "Execution scope, materials, labor & installation": "نطاق التنفيذ والمواد والعمالة والتركيب",

  // Documents ("Reference" is defined with the materials fields above)
  "Document Center": "مركز المستندات",
  "Contracts, specifications, reports, and every reference file in one place.": "العقود والمواصفات والتقارير وكل الملفات المرجعية في مكان واحد.",
  "No documents yet": "لا توجد مستندات بعد",
  "Reference documents will appear here as they become available.": "ستظهر المستندات المرجعية هنا فور توفرها.",
  "Download to view": "نزّل الملف لعرضه",

  // Approvals
  "Design Approvals": "اعتمادات التصميم",
  "Review each milestone and let NEON know if it’s ready to move forward.": "راجع كل مرحلة وأخبر NEON إن كانت جاهزة للمضي قدمًا.",
  "No approvals needed yet": "لا توجد اعتمادات مطلوبة بعد",
  "Approval milestones will appear here as designs are ready for your review.": "ستظهر مراحل الاعتماد هنا عندما تصبح التصاميم جاهزة لمراجعتك.",
  "Pending Review": "بانتظار المراجعة",
  "Request Changes": "طلب تعديلات",
  "Approve Design": "اعتماد التصميم",
  "Are you sure you want to approve this design? This will be recorded with your name and today’s date.": "هل أنت متأكد من اعتماد هذا التصميم؟ سيتم تسجيل ذلك باسمك وتاريخ اليوم.",
  "Let NEON know what you’d like changed.": "أخبر NEON بما تود تغييره.",
  "Your Name": "اسمك",
  "What would you like changed?": "ما الذي تود تغييره؟",
  "Submitting…": "جارٍ الإرسال…",
  "Confirm Approval": "تأكيد الاعتماد",
  "Send to NEON": "إرسال إلى NEON",

  // Feedback
  "Communicate": "تواصل",
  "Review & Feedback": "المراجعة والملاحظات",
  "Have a note or a change request? Send it directly to NEON.": "لديك ملاحظة أو طلب تعديل؟ أرسله مباشرة إلى NEON.",
  "Referring to (optional)": "بخصوص (اختياري)",
  "e.g. Kitchen Render": "مثال: صورة المطبخ",
  "Message": "الرسالة",
  "Change this sofa to a darker color…": "مثال: غيّروا لون هذه الكنبة إلى درجة أغمق…",
  "Sending…": "جارٍ الإرسال…",
  "No messages yet — your feedback will appear here.": "لا توجد رسائل بعد — ستظهر ملاحظاتك هنا.",
  "NEON Team": "فريق NEON",
  "Open": "مفتوح",
  "Resolved": "تم الحل",

  // Handover
  "Project Completed": "اكتمل المشروع",
  "Download Center": "مركز التنزيلات",
  "Your project is ready. Everything NEON delivered is available below.": "مشروعك جاهز. كل ما سلّمته NEON متاح بالأسفل.",
  "Everything delivered so far, in one place.": "كل ما تم تسليمه حتى الآن، في مكان واحد.",
  "Final Renders": "الصور النهائية",
  "Bill of Quantities": "جدول الكميات",
  "Material Schedule": "جدول المواد",
  "Furniture Schedule": "جدول الأثاث",
  "Specifications & Documents": "المواصفات والمستندات",
  "Download Complete Project Package": "تنزيل حزمة المشروع الكاملة",

  // Share
  "Copy Link": "نسخ الرابط",
  "Copied": "تم النسخ",
  "WhatsApp": "واتساب",
  "Reviewing our project “{name}” from NEON — take a look: {url}": "نراجع مشروعنا «{name}» من NEON — ألقِ نظرة: {url}",

  // Presentation slides
  "The Concept": "الفكرة",
  "Materials & Finishes": "المواد والتشطيبات",
  "Furniture & Products": "الأثاث والمنتجات",
};

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export function useI18n() {
  return useContext(I18nContext);
}

const STORAGE_KEY = "neon-client-lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Server render and first client render are always English — the stored
  // choice applies right after mount, which avoids a hydration mismatch.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    const initial: Lang =
      stored === "ar" || stored === "en"
        ? stored
        : navigator.language?.startsWith("ar")
          ? "ar"
          : "en";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with localStorage/navigator, browser-only external systems; can't be known at render/SSR time.
    setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }

  function t(key: string, vars?: Record<string, string | number>) {
    let text = lang === "ar" ? (AR[key] ?? key) : key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

// Floating pill that flips the page language, always reachable.
export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className="glass-strong fixed end-5 top-5 z-50 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-ink shadow-lg transition-transform hover:scale-105"
      aria-label="Switch language"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {lang === "ar" ? "English" : "عربي"}
    </button>
  );
}
