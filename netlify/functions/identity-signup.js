const RESEND_API_URL = 'https://api.resend.com/emails';
const ADMIN_EMAIL = 'admin@dnevnik.live';

function parseIdentityEvent(body) {
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

async function sendEmail(apiKey, payload) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email API error (${response.status}): ${errorText}`);
  }
}

exports.handler = async (event) => {
  const { user = {} } = parseIdentityEvent(event.body);
  const userEmail = user.email;

  if (!userEmail) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No user email on signup event.' }),
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SIGNUP_EMAIL_FROM || process.env.EMAIL_FROM || 'no-reply@dnevnik.live';

  if (!resendApiKey) {
    console.warn('identity-signup: RESEND_API_KEY is not set, skipping signup emails.');
    return { statusCode: 200, body: JSON.stringify({ message: 'Signup processed without email delivery.' }) };
  }

  const userSubject = 'Potvrda registracije';
  const userHtml = `
    <p>Pozdrav,</p>
    <p>račun je uspješno kreiran za adresu <strong>${userEmail}</strong>.</p>
    <p>Dobrodošli na Dnevnik.</p>
  `;

  const adminSubject = 'Novi korisnik je registriran';
  const adminHtml = `
    <p>Novi korisnik je kreiran.</p>
    <p>Email korisnika: <strong>${userEmail}</strong></p>
  `;

  try {
    await Promise.all([
      sendEmail(resendApiKey, {
        from: fromEmail,
        to: userEmail,
        subject: userSubject,
        html: userHtml,
      }),
      sendEmail(resendApiKey, {
        from: fromEmail,
        to: ADMIN_EMAIL,
        subject: adminSubject,
        html: adminHtml,
      }),
    ]);
  } catch (error) {
    console.error('identity-signup: failed to send signup emails', error);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({}),
  };
};
