import {
  AuthError,
  MissingIdentityError,
  getUser,
  handleAuthCallback,
  login,
  signup,
} from 'https://cdn.jsdelivr.net/npm/@netlify/identity/+esm';

const form = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const toggleBtn = document.getElementById('toggle-mode');

const nextPath = getSafeNextPath();
let mode = 'login';

function getSafeNextPath() {
  const value = new URLSearchParams(window.location.search).get('next') || '/app/';
  return value.startsWith('/') ? value : '/app/';
}

function setMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.classList.toggle('error', Boolean(isError));
}

function setMode(nextMode) {
  mode = nextMode;
  submitBtn.textContent = mode === 'login' ? 'Prijavi se' : 'Registriraj račun';
  toggleBtn.textContent = mode === 'login'
    ? 'Nemate račun? Registrirajte se'
    : 'Već imate račun? Prijavite se';
  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  setMessage('', false);
}

function redirectAfterAuth() {
  window.location.replace(nextPath);
}

async function handleInitialState() {
  try {
    const callback = await handleAuthCallback();
    const callbackUser = callback && callback.user ? callback.user : null;
    if (callbackUser) {
      redirectAfterAuth();
      return;
    }
    const user = await getUser();
    if (user) redirectAfterAuth();
  } catch (error) {
    if (error instanceof MissingIdentityError) {
      setMessage('Prijava trenutno nije dostupna jer Netlify Identity nije uključen.', true);
      return;
    }
    if (error instanceof AuthError) {
      setMessage(error.message, true);
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  setMessage('', false);
  submitBtn.disabled = true;

  try {
    if (mode === 'login') {
      await login(emailInput.value.trim(), passwordInput.value);
      redirectAfterAuth();
      return;
    }

    const user = await signup(emailInput.value.trim(), passwordInput.value);
    if (user.emailVerified) {
      redirectAfterAuth();
      return;
    }
    setMessage('Račun je kreiran. Potvrdite email pa se prijavite.', false);
    setMode('login');
  } catch (error) {
    if (error instanceof MissingIdentityError) {
      setMessage('Netlify Identity nije konfiguriran za ovaj projekt.', true);
      return;
    }
    if (error instanceof AuthError) {
      if (error.status === 401) setMessage('Neispravan email ili lozinka.', true);
      else if (error.status === 403) setMessage('Registracija trenutno nije dopuštena.', true);
      else if (error.status === 422) setMessage('Unesite valjan email i lozinku (min. 6 znakova).', true);
      else setMessage(error.message || 'Greška pri prijavi.', true);
      return;
    }
    setMessage('Dogodila se neočekivana greška. Pokušajte ponovno.', true);
  } finally {
    submitBtn.disabled = false;
  }
});

toggleBtn.addEventListener('click', () => {
  setMode(mode === 'login' ? 'signup' : 'login');
});

handleInitialState();
