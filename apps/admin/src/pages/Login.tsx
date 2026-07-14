import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';
import { config } from '../config';
import { initGoogleAuth, renderGoogleButton } from '../auth/google';
import { ApiError } from '../api/client';

export function Login() {
  const { isAdmin, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isAdmin) navigate('/', { replace: true });
  }, [isAdmin, navigate]);

  useEffect(() => {
    let cancelled = false;
    if (!config.googleClientId) {
      setError('VITE_ADMIN_GOOGLE_CLIENT_ID is not configured.');
      return;
    }
    initGoogleAuth(config.googleClientId, async (idToken) => {
      setPending(true);
      setError(null);
      try {
        await loginWithGoogle(idToken);
        navigate('/', { replace: true });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Login failed.';
        setError(err instanceof ApiError && err.status === 403 ? 'This email is not allowed to sign in.' : msg);
      } finally {
        if (!cancelled) setPending(false);
      }
    })
      .then((id) => {
        if (!cancelled && buttonRef.current) renderGoogleButton(id, buttonRef.current);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle, navigate]);

  return (
    <Center h="100vh">
      <Card withBorder shadow="sm" padding="xl" radius="md" w={360}>
        <Stack align="center" gap="md">
          <Title order={3}>Admin sign in</Title>
          <Text size="sm" c="dimmed" ta="center">
            Restricted to whitelisted administrators.
          </Text>
          {error && <Alert color="red" w="100%">{error}</Alert>}
          <div ref={buttonRef} />
          {pending && <Loader size="sm" />}
        </Stack>
      </Card>
    </Center>
  );
}
