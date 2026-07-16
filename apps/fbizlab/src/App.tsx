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

export function App() {
  const { lang } = useLang();
  const { pathname } = useLocation();
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  // Only the public landing is indexable; the authed app + login are noindex.
  useEffect(() => {
    const priv = pathname.startsWith('/app') || pathname.startsWith('/login');
    let m = document.querySelector('meta[name="robots"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'robots'); document.head.appendChild(m); }
    m.setAttribute('content', priv ? 'noindex, nofollow' : 'index, follow');
  }, [pathname]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
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
