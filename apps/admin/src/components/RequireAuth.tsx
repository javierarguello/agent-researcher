import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** Route guard: only admin sessions may pass; others go to /login. */
export function RequireAuth() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  if (!isAdmin) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
