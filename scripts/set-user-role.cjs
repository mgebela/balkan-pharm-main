// Postavi (ili samo pregledaj) Firestore ulogu korisnika preko prijavljenog Firebase CLI-a.
//
// Pregled (ne mijenja ništa):
//   node scripts/set-user-role.cjs user@example.com
//
// Primjena nove uloge:
//   node scripts/set-user-role.cjs user@example.com --apply admin
//
// Napomena: zahtijeva prijavljen Firebase CLI (firebase login) s računom koji
// ima IAM ovlasti (Owner/Editor/datastore.user) nad projektom.

const auth = require('firebase-tools/lib/auth');

const PROJECT = 'balpha-9dab9';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const TARGET = (process.argv[2] || '').toLowerCase();
const applyIdx = process.argv.indexOf('--apply');
const NEW_ROLE = applyIdx !== -1 ? process.argv[applyIdx + 1] : null;

if (!TARGET) {
  console.error('Usage: node scripts/set-user-role.cjs <email> [--apply <role>]');
  process.exit(1);
}

async function getToken() {
  const account = auth.getGlobalDefaultAccount();
  const res = await auth.getAccessToken(account, []);
  return res.access_token || res;
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };

  let users = [];
  let pageToken = '';
  do {
    const url = `${BASE}/users?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.error('LIST FAILED', r.status, await r.text());
      process.exit(1);
    }
    const data = await r.json();
    users = users.concat(data.documents || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  const matches = users.filter((d) => {
    const email = (d.fields && d.fields.email && d.fields.email.stringValue) || '';
    return email.toLowerCase() === TARGET;
  });

  if (!matches.length) {
    console.log(`NEMA korisničkog dokumenta za ${TARGET}.`);
    console.log('Korisnik se mora barem jednom prijaviti u aplikaciju da bi se kreirao zapis.');
    return;
  }

  if (matches.length > 1) {
    console.warn(`UPOZORENJE: pronađeno ${matches.length} zapisa za ${TARGET}.`);
  }

  for (const d of matches) {
    const id = d.name.split('/').pop();
    const f = d.fields || {};
    console.log('Korisnik ->', JSON.stringify({
      docId: id,
      email: f.email && f.email.stringValue,
      role: (f.role && f.role.stringValue) || 'user',
      uId: f.uId && f.uId.stringValue,
    }));

    if (NEW_ROLE) {
      const patchUrl = `${BASE}/users/${id}?updateMask.fieldPaths=role`;
      const r = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { role: { stringValue: NEW_ROLE } } }),
      });
      if (!r.ok) {
        console.error('PATCH FAILED', r.status, await r.text());
        process.exit(1);
      }
      console.log(`  ✅ Uloga postavljena na "${NEW_ROLE}".`);
    }
  }

  if (!NEW_ROLE) {
    console.log('\n(Samo pregled — ništa nije promijenjeno. Dodaj "--apply admin" za primjenu.)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
