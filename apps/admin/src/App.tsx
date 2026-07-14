import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Apps } from './pages/Apps';
import { Users } from './pages/Users';
import { Jobs } from './pages/Jobs';
import { JobDetail } from './pages/JobDetail';
import { NewJob } from './pages/NewJob';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/new" element={<NewJob />} />
          <Route path="jobs/:jobId" element={<JobDetail />} />
          <Route path="users" element={<Users />} />
          <Route path="apps" element={<Apps />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
