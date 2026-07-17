import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLang, pick } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { LangSwitcher } from '../components/LangSwitcher';
import { ApiError, contactRequest } from '../api/client';

const BRAND = 'Florida Biz Labs';
const MARK = '/icons/favicon.svg';

const T = {
  en: {
    eyebrow: 'API & MCP', title: 'API & MCP access', login: 'Log In', home: '← Home',
    eyebrowInfo: 'Contact', titleInfo: 'Request information', leadInfo: 'Have a question or want more information? Send us a message and we’ll get back to you.',
    lead: `Contact us for more information about API or MCP access to ${BRAND}.`,
    subject: 'Subject', subjectPh: 'What do you need?', name: 'Name', namePh: 'Your name',
    email: 'Contact email', emailPh: 'you@company.com', message: 'Message', messagePh: 'Tell us a bit about your use case…',
    send: 'Send request', busy: 'Sending…',
    okTitle: 'Thanks — request sent', okSub: 'We received your request and will get back to you soon.',
    err: 'Could not send your message. Please try again.',
  },
  es: {
    eyebrow: 'API y MCP', title: 'Acceso a API y MCP', login: 'Ingresar', home: '← Inicio',
    eyebrowInfo: 'Contacto', titleInfo: 'Solicitar información', leadInfo: '¿Tienes una pregunta o quieres más información? Envíanos un mensaje y te respondemos.',
    lead: `Contáctanos para más información sobre acceso a API o MCP de ${BRAND}.`,
    subject: 'Asunto', subjectPh: '¿Qué necesitas?', name: 'Nombre', namePh: 'Tu nombre',
    email: 'Email de contacto', emailPh: 'tú@empresa.com', message: 'Mensaje', messagePh: 'Cuéntanos un poco sobre tu caso de uso…',
    send: 'Enviar solicitud', busy: 'Enviando…',
    okTitle: 'Gracias — solicitud enviada', okSub: 'Recibimos tu solicitud y te responderemos pronto.',
    err: 'No pudimos enviar tu mensaje. Inténtalo de nuevo.',
  },
  fr: {
    eyebrow: 'API et MCP', title: 'Accès API et MCP', login: 'Se connecter', home: '← Accueil',
    eyebrowInfo: 'Contact', titleInfo: 'Demander des informations', leadInfo: 'Une question ou besoin d’informations ? Envoyez-nous un message et nous vous répondrons.',
    lead: `Contactez-nous pour plus d’informations sur l’accès API ou MCP à ${BRAND}.`,
    subject: 'Objet', subjectPh: 'De quoi avez-vous besoin ?', name: 'Nom', namePh: 'Votre nom',
    email: 'Email de contact', emailPh: 'vous@entreprise.com', message: 'Message', messagePh: 'Parlez-nous de votre cas d’usage…',
    send: 'Envoyer la demande', busy: 'Envoi…',
    okTitle: 'Merci — demande envoyée', okSub: 'Nous avons reçu votre demande et reviendrons vers vous bientôt.',
    err: 'Impossible d’envoyer votre message. Réessayez.',
  },
  pt: {
    eyebrow: 'API e MCP', title: 'Acesso a API e MCP', login: 'Entrar', home: '← Início',
    eyebrowInfo: 'Contato', titleInfo: 'Solicitar informações', leadInfo: 'Tem uma pergunta ou quer mais informações? Envie uma mensagem e retornaremos.',
    lead: `Fale conosco para mais informações sobre acesso a API ou MCP da ${BRAND}.`,
    subject: 'Assunto', subjectPh: 'Do que você precisa?', name: 'Nome', namePh: 'Seu nome',
    email: 'Email de contato', emailPh: 'voce@empresa.com', message: 'Mensagem', messagePh: 'Conte um pouco sobre seu caso de uso…',
    send: 'Enviar solicitação', busy: 'Enviando…',
    okTitle: 'Obrigado — solicitação enviada', okSub: 'Recebemos sua solicitação e retornaremos em breve.',
    err: 'Não foi possível enviar sua mensagem. Tente de novo.',
  },
};

function ContactForm({ variant }: { variant: 'api' | 'info' }) {
  const { lang } = useLang();
  const t = pick(T, lang);
  const { user } = useAuth();
  const homeHref = lang === 'en' ? '/' : `/${lang}`;
  const eyebrow = variant === 'info' ? t.eyebrowInfo : t.eyebrow;
  const heading = variant === 'info' ? t.titleInfo : t.title;
  const lead = variant === 'info' ? t.leadInfo : t.lead;
  const [subject, setSubject] = useState('');
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await contactRequest({ subject: subject || undefined, name, email, message });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="hdr">
        <div className="container">
          <Link className="brand" to={homeHref}><img className="brand-mark" src={MARK} alt="" width="26" height="26" />{BRAND}</Link>
          <div className="row" style={{ gap: 12 }}>
            <LangSwitcher />
            <Link className="btn btn--black btn--sm" to="/login">{t.login}</Link>
          </div>
        </div>
      </header>

      <main className="container legal">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h-lg" style={{ margin: '10px 0 10px' }}>{heading}</h1>
        <p className="lead" style={{ maxWidth: '42rem', marginBottom: 30 }}>{lead}</p>

        {sent ? (
          <div className="card" style={{ padding: 26, maxWidth: 460 }}>
            <h2 style={{ fontSize: 20, margin: '0 0 6px', letterSpacing: '-0.02em' }}>{t.okTitle}</h2>
            <p className="soft" style={{ fontSize: 14.5, lineHeight: 1.6 }}>{t.okSub}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate style={{ maxWidth: 460 }}>
            {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 14 }}>{error}</div>}
            <div className="auth-field">
              <label htmlFor="c-subject">{t.subject}</label>
              <input id="c-subject" className="input" type="text" placeholder={t.subjectPh} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="auth-field">
              <label htmlFor="c-name">{t.name}</label>
              <input id="c-name" className="input" type="text" autoComplete="name" placeholder={t.namePh} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label htmlFor="c-email">{t.email}</label>
              <input id="c-email" className="input" type="email" autoComplete="email" placeholder={t.emailPh} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label htmlFor="c-message">{t.message}</label>
              <textarea id="c-message" className="textarea" style={{ minHeight: 120 }} placeholder={t.messagePh} value={message} onChange={(e) => setMessage(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn--black" style={{ marginTop: 4 }} disabled={busy}>{busy ? t.busy : t.send}</button>
          </form>
        )}

        <div style={{ marginTop: 40 }}>
          <Link to={homeHref} className="mono muted" style={{ fontSize: 11 }}>{t.home}</Link>
        </div>
      </main>
    </div>
  );
}

export const ApiAccess = () => <ContactForm variant="api" />;
export const ContactInfo = () => <ContactForm variant="info" />;
