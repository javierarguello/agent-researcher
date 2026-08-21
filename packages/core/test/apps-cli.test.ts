/**
 * The CLI is the only surface that can configure an app during a first bring-up,
 * and for two fields it was the only surface that could not.
 *
 * `emailFrom` and `webUrl` have been on `AppRecord` and accepted by `createApp` /
 * `updateApp` all along. Nothing passed them: the CLI had no flags, the admin SPA
 * renders no field for either, and `PATCH /admin/apps/:appId` — which does carry
 * them — needs an admin SESSION, i.e. a Google id_token for an address already in
 * the app's `adminEmails`. On the empty Firestore of a brand-new environment that
 * is a closed loop, and the consequence is not cosmetic: `POST /auth/register`
 * returns 500 when either is missing (apps/api/src/index.ts:456), so no buyer can
 * verify an email, which is every buyer.
 *
 * These tests drive `run(argv)` — the real command, real flag parsing, against the
 * in-memory Firestore — rather than calling the store, because the store was never
 * the broken half. Revert the two `arg('email-from')` / `arg('web-url')` lines in
 * `create` and `update` and both `emailFrom`/`webUrl` assertions go red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run } from '../src/cli/apps.js';
import { getApp } from '../src/apps/store.js';

/** `npm run apps -- <args>` reaches the CLI as argv[2..]. */
const argv = (...args: string[]) => ['node', 'apps.ts', ...args];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('apps CLI — the fields only it can write', () => {
  it('create stores the From address and the web origin', async () => {
    await run(
      argv(
        'create',
        '--appId',
        'fbizlab',
        '--name',
        'FloridaBizLab',
        '--allowed-templates',
        'florida-business-for-sale',
        '--email-from',
        'FloridaBizLab <no-reply@floridabizlabs.com>',
        '--web-url',
        'https://agent-researcher-prod-fbizlab.web.app',
      ),
    );

    const app = await getApp('fbizlab');
    expect(app?.emailFrom).toBe('FloridaBizLab <no-reply@floridabizlabs.com>');
    expect(app?.webUrl).toBe('https://agent-researcher-prod-fbizlab.web.app');
    // The control: the flags that already worked still do, so a change that broke
    // everything would not read as a pass here.
    expect(app?.allowedTemplates).toEqual(['florida-business-for-sale']);
  });

  it('update sets them on an app created without them', async () => {
    await run(argv('create', '--appId', 'later', '--name', 'Configured later'));
    expect((await getApp('later'))?.emailFrom).toBeUndefined();

    await run(
      argv(
        'update',
        '--appId',
        'later',
        '--email-from',
        'Later <no-reply@later.test>',
        '--web-url',
        'https://later.test',
      ),
    );

    const app = await getApp('later');
    expect(app?.emailFrom).toBe('Later <no-reply@later.test>');
    expect(app?.webUrl).toBe('https://later.test');
  });

  it('strips a trailing slash, because the value is concatenated into a link', async () => {
    // `${webUrl}/verify?token=…` (apps/api/src/index.ts:481). A pasted URL ending in
    // "/" produces "…web.app//verify?token=…", and the buyer who clicks it is the
    // one who finds out.
    await run(argv('create', '--appId', 'slashy', '--name', 'Slashy', '--web-url', 'https://slashy.test/'));
    expect((await getApp('slashy'))?.webUrl).toBe('https://slashy.test');

    await run(argv('update', '--appId', 'slashy', '--web-url', 'https://slashy.test/other/'));
    expect((await getApp('slashy'))?.webUrl).toBe('https://slashy.test/other');
  });

  it('leaves an unmentioned field alone on update', async () => {
    // `update` builds a sparse patch: a flag nobody passed must not clear what is
    // already there, or configuring the web URL would silently drop the sender.
    await run(
      argv('create', '--appId', 'keep', '--name', 'Keep', '--email-from', 'Keep <a@b.test>', '--web-url', 'https://b.test'),
    );
    await run(argv('update', '--appId', 'keep', '--active', 'false'));

    const app = await getApp('keep');
    expect(app?.active).toBe(false);
    expect(app?.emailFrom).toBe('Keep <a@b.test>');
    expect(app?.webUrl).toBe('https://b.test');
  });
});
