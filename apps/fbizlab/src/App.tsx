import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLang } from './i18n';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';
import { NewReport } from './pages/NewReport';
import { JobView } from './pages/JobView';
import { Credits } from './pages/Credits';
import { ReadReport } from './pages/ReadReport';
import { SampleReport } from './pages/SampleReport';
import { VerifyEmail } from './pages/VerifyEmail';
import { ResetPassword } from './pages/ResetPassword';
import { Privacy, Terms, Support } from './pages/Legal';
import { trackPageView } from './analytics';
import { ApiAccess, ContactInfo } from './pages/ApiAccess';

const TITLES: Record<string, string> = {
  en: 'Florida Biz Labs — Research businesses for sale in Florida',
  es: 'Florida Biz Labs — Investiga negocios en venta en Florida',
  fr: 'Florida Biz Labs — Recherchez des entreprises à vendre en Floride',
  pt: 'Florida Biz Labs — Pesquise negócios à venda na Flórida',
};

export function App() {
  const { lang } = useLang();
  const { pathname } = useLocation();
  useEffect(() => { document.documentElement.lang = lang; if (TITLES[lang]) document.title = TITLES[lang]; }, [lang]);
  // Only the public landing is indexable; the authed app + login are noindex.
  useEffect(() => {
    const priv = pathname.startsWith('/app') || pathname.startsWith('/login') || pathname.startsWith('/report') || pathname.startsWith('/verify') || pathname.startsWith('/reset');
    let m = document.querySelector('meta[name="robots"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'robots'); document.head.appendChild(m); }
    m.setAttribute('content', priv ? 'noindex, nofollow' : 'index, follow');
  }, [pathname]);

  // One screen view per route change.
  //
  // A client-routed app fires exactly ONE browser navigation — the first load — so
  // without this the whole product reports as a single page view and every step a
  // visitor takes after arriving is invisible. That is the half of "add analytics"
  // that gets forgotten, because the tag looks like it is working.
  //
  // `pathname` only, never `search`: `/verify` and `/reset` carry single-purpose auth
  // tokens in the query and `/report/:jobId` carries the share token that authorizes
  // it. `trackPageView` re-sanitizes anyway — the guard belongs next to the value,
  // not next to the caller — but nothing here even offers it the query string.
  useEffect(() => { trackPageView(pathname); }, [pathname]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      {/* Language in the URL for SEO (en = "/"); prerendered per-language at build. */}
      <Route path="/es" element={<Landing />} />
      <Route path="/fr" element={<Landing />} />
      <Route path="/pt" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify" element={<VerifyEmail />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/legal" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      <Route path="/api-access" element={<ApiAccess />} />
      <Route path="/contact" element={<ContactInfo />} />
      {/* Admin read-only report link (?rt=token) — auth is the token itself. */}
      {/* Public, anonymous, no API: one static dossier from a real run. Outside
          `RequireAuth` on purpose — it is the landing's "see a sample" made real. */}
      <Route path="/sample" element={<SampleReport />} />
      <Route path="/report/:jobId" element={<ReadReport />} />
      <Route path="/app" element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Reports />} />
          <Route path="new" element={<NewReport />} />
          <Route path="jobs/:jobId" element={<JobView />} />
          <Route path="credits" element={<Credits />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
