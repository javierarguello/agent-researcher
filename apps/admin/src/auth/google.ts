/** Thin wrapper over Google Identity Services (loaded in index.html). */

/** Resolve once the GIS script has loaded `window.google.accounts.id`. */
export function loadGoogle(timeoutMs = 8000): Promise<GoogleAccountsId> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
      if (Date.now() - start > timeoutMs) return reject(new Error('Google Identity Services failed to load.'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Initialize GIS with our client id and a credential (id_token) callback. */
export async function initGoogleAuth(clientId: string, onCredential: (idToken: string) => void): Promise<GoogleAccountsId> {
  const id = await loadGoogle();
  id.initialize({ client_id: clientId, callback: (res) => onCredential(res.credential) });
  return id;
}

/** Render the official Google sign-in button into a container. */
export function renderGoogleButton(id: GoogleAccountsId, container: HTMLElement): void {
  id.renderButton(container, { theme: 'outline', size: 'large', width: 280, text: 'signin_with' });
}
