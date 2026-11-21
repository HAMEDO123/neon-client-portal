import type { Metadata } from "next";

// Public privacy policy (2026-11-21). Needed by Meta to switch the "NEON Ads" app to Live mode
// (Privacy Policy URL + User Data Deletion instructions) and useful for the App Store listing.
// Static, no auth, no database — safe to render for crawlers (robots.ts allows /privacy).

export const metadata: Metadata = {
  title: "Privacy Policy — NEON",
  description: "How NEON collects, uses and protects personal data.",
  robots: { index: true, follow: false },
};

const UPDATED = "21 November 2026";
const PHONE = "+962 77 588 0677";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink/75">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <span className="text-gradient-neon text-2xl font-bold tracking-tight">NEON</span>
      <h1 className="mt-4 text-3xl font-semibold text-ink">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink/55">Last updated: {UPDATED}</p>

      <p className="mt-6 text-sm leading-relaxed text-ink/75">
        NEON (&ldquo;we&rdquo;) is an architecture, interior design, 3D visualization and software studio in Amman, Jordan.
        This policy explains what personal data we handle through our website, our advertising on Facebook,
        Instagram and WhatsApp, our client project portal, and the NEON apps used by our team.
      </p>

      <Section title="1. Data we collect">
        <p><b>When you contact us</b> (WhatsApp, Messenger, Instagram, phone or a form): your name, phone number,
          the messages you send, and details you share about your project (area, location, photos, plans).</p>
        <p><b>From our ads on Meta platforms:</b> Meta gives us aggregated, non-identifying results (reach, clicks,
          number of conversations, spend). We do not receive your Facebook profile data from ads.</p>
        <p><b>Client project portal:</b> files, drawings, renders, comments and approvals you exchange with us.</p>
        <p><b>NEON team apps (employees only):</b> work account details, tasks, uploaded work files, attendance and,
          during working hours only, location — as described to employees in the app.</p>
      </Section>

      <Section title="2. How we use it">
        <p>To reply to you, prepare quotes and designs, deliver and manage your project, improve our services and
          advertising (using aggregated statistics), and meet legal obligations. We do not sell personal data.</p>
      </Section>

      <Section title="3. Sharing">
        <p>Only with service providers that run our tools — Meta (Facebook, Instagram, WhatsApp) for messaging and ads,
          Cloudflare for hosting and file storage, and Apple for app notifications — and only as needed for these services,
          or when required by law.</p>
      </Section>

      <Section title="4. Retention and security">
        <p>We keep project data while the project is active and for as long as needed for warranty, accounting and legal
          purposes, then delete or anonymise it. Access is limited to authorised NEON staff and protected by passwords
          and encrypted connections (HTTPS).</p>
      </Section>

      <Section id="data-deletion" title="5. Your rights — access and deletion of your data">
        <p>You can ask to see, correct or delete your personal data at any time, including data connected to our Facebook /
          Instagram apps. To request deletion:</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Send a WhatsApp message to <b dir="ltr">{PHONE}</b> or a message to our Facebook page <b>NEON.Jo</b> with the
            words &ldquo;Delete my data&rdquo; and the phone number or name you used with us.</li>
          <li>We confirm your request and delete your data within 30 days, except what we must keep by law (e.g. invoices).</li>
        </ol>
        <p>You can also remove our app&rsquo;s access from Facebook: Settings &amp; Privacy → Settings → Apps and Websites → Remove.</p>
      </Section>

      <Section title="6. Children">
        <p>Our services are not directed to children under 13 and we do not knowingly collect their data.</p>
      </Section>

      <Section title="7. Contact">
        <p>NEON — Amman, Jordan · WhatsApp / phone: <b dir="ltr">{PHONE}</b> · Facebook / Instagram: NEON.Jo</p>
        <p>We may update this policy; the date above shows the latest version.</p>
      </Section>

      <hr className="my-10 border-ink/10" />

      <div dir="rtl" lang="ar" className="text-right">
        <h2 className="text-2xl font-semibold text-ink">سياسة الخصوصية — ملخّص بالعربي</h2>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink/75">
          <p>نيون (NEON) استوديو عمارة وتصميم داخلي وتصوّر ثلاثي الأبعاد وبرمجيات في عمّان، الأردن.</p>
          <p><b>شو منجمع:</b> اسمك ورقمك ورسائلك وتفاصيل مشروعك لما تتواصل معنا (واتساب، ماسنجر، إنستغرام، هاتف).
            من إعلاناتنا على ميتا بيوصلنا أرقام إجمالية بس (وصول، نقرات، عدد محادثات) — مش بيانات حسابك.</p>
          <p><b>ليش:</b> عشان نرد عليك، نعمل عرض السعر والتصميم، ونسلّم المشروع. ما منبيع بياناتك لحدا.</p>
          <p><b>مع مين منشاركها:</b> بس مع مزوّدي الخدمات اللي بنشتغل عليهم (ميتا، Cloudflare، آبل) وبالقدر اللازم.</p>
          <p id="data-deletion-ar"><b>حذف بياناتك:</b> ابعت «احذف بياناتي» على واتساب <span dir="ltr">{PHONE}</span> أو لصفحة NEON.Jo،
            ومنحذفها خلال 30 يوم (إلا اللي القانون بيلزمنا نحتفظ فيه مثل الفواتير).</p>
        </div>
      </div>
    </main>
  );
}
