import { AppShell, Burger, Group, NavLink, Text, Button, Badge } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/users', label: 'Users' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/apps', label: 'Apps' },
];

export function Layout() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>agent-researcher</Text>
            <Badge variant="light" color="grape">admin</Badge>
          </Group>
          <Group>
            <Text size="sm" c="dimmed">{user?.email}</Text>
            <Button size="xs" variant="subtle" onClick={logout}>Log out</Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            component={RouterNavLink}
            to={item.to}
            label={item.label}
            active={item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)}
            onClick={() => opened && toggle()}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
