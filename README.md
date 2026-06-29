# SchoolOS — Deployment Guide

Ethiopian School Management System · Single-file PWA  
Frontend: **Netlify** · Backend: **Firebase** (Firestore + Auth) · CI/CD: **GitHub Actions**

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| Firebase CLI | latest | `npm i -g firebase-tools` |
| Netlify CLI | latest | `npm i -g netlify-cli` |
| Git | any | https://git-scm.com |

---

## Step 1 — Create Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. Name it `school-erp-et` (must match the project ID in `.firebaserc`).
3. **Authentication** → Get started → Sign-in method → **Email/Password** → Enable.
4. **Firestore Database** → Create database → **Native mode** → choose a region
   close to Ethiopia (e.g. `europe-west1` or `asia-south1`).
5. Note your project's **Firebase config object**:  
   Project settings → Your apps → Web app → SDK setup and configuration.

---

## Step 2 — Configure Firebase in `index.html`

Open `index.html` and find the `firebaseConfig` object near the top of the
`<script>` block (search for `apiKey`). Replace every value with the config
from Step 1:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "school-erp-et.firebaseapp.com",
  projectId:         "school-erp-et",
  storageBucket:     "school-erp-et.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

Commit and push the change to `main`.

---

## Step 3 — Create a Netlify site

1. Log in to [Netlify](https://app.netlify.com) → **Add new site** →
   **Import an existing project** → connect your GitHub repository.
2. Build settings:
   - **Build command**: *(leave blank — no build step)*
   - **Publish directory**: `.`
3. Click **Deploy site**.
4. After the first deploy, note your **Site ID** from  
   *Site → Site configuration → Site details → Site ID*.

---

## Step 4 — Add GitHub Secrets

In your GitHub repository go to **Settings → Secrets and variables → Actions →
New repository secret** and add all three:

| Secret name | How to obtain |
|-------------|---------------|
| `NETLIFY_AUTH_TOKEN` | Netlify UI → User Settings → Applications → Personal access tokens → **New access token** |
| `NETLIFY_SITE_ID` | Netlify UI → Site → Site configuration → Site details → **Site ID** |
| `FIREBASE_TOKEN` | Run `npx firebase-tools login:ci` locally and copy the printed token |

---

## Step 5 — Push to `main` to trigger deployment

```bash
git add .
git commit -m "Initial SchoolOS deployment"
git push origin main
```

GitHub Actions will automatically:

1. Deploy `index.html` to Netlify (`netlify deploy --prod --dir .`).
2. Deploy `firestore.rules` and `firestore.indexes.json` to Firebase
   (`firebase deploy --only firestore:rules,firestore:indexes`).

Monitor progress in the **Actions** tab of your GitHub repository.

---

## Step 6 — Create the first admin user

Firebase Authentication does not create Firestore user documents automatically.
Bootstrap the first admin manually:

**A. Create the Auth account**

1. Firebase Console → **Authentication** → **Users** → **Add user**.
2. Enter the admin's email and a temporary password.
3. Copy the generated **UID**.

**B. Create the Firestore user document**

1. Firebase Console → **Firestore** → data panel → start collection `users`.
2. Document ID: *(the UID from above)*.
3. Add these fields:

| Field | Type | Value |
|-------|------|-------|
| `uid` | string | *(same UID)* |
| `role` | string | `admin` |
| `active` | boolean | `true` |
| `displayName` | string | Admin's full name |
| `email` | string | Admin's email address |

The admin can now sign in and use **Admin → Users** to create all other
staff accounts from within the app.

---

## Step 7 — Seed initial data *(optional)*

If a seed script was created in a previous build step (Step 38), run it
against the live project:

```bash
# Against the Firebase Emulator (recommended for initial testing)
firebase emulators:start
node seed.js

# Against the live project (once you are confident in the data)
FIREBASE_TOKEN=<your-token> node seed.js --project school-erp-et
```

The seed script typically creates:

- `schoolConfig/main` — school name, current EC year, semester dates,
  grade levels, sections, and tuition rates per grade.
- Sample `subjects` documents (Mathematics, Amharic, English, Science, …).
- One or more `classes` for the current academic year.

---

## Verify the deployment

After the GitHub Actions workflow completes successfully:

1. Open your Netlify URL. The SchoolOS login screen should appear.
2. Sign in as the admin created in Step 6.
3. Go to **Admin → Settings** — the security-rules gate banner should be
   **dismissed** (no red dot in the nav bar), confirming the rules were deployed.
4. *(Optional)* Navigate to **Admin → Settings → Security Rules Test Suite**
   and run the in-app tests to verify rule coverage across all roles.

---

## Local development

```bash
# Serve index.html locally — no build step required
npx serve .

# Or use the Firebase Emulator Suite for full offline development
firebase emulators:start
# The app detects localhost and connects to the emulator automatically.
```

---

## Repository structure

```
.
├── index.html                    # The entire SchoolOS application
├── netlify.toml                  # Netlify SPA redirect + cache/security headers
├── firestore.rules               # Firestore security rules (role-based)
├── firestore.indexes.json        # Composite indexes for all DAL queries
├── .firebaserc                   # Default Firebase project (school-erp-et)
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions CI/CD pipeline
└── README.md                     # This file
```

---

## Architecture reference

| Layer | Technology |
|-------|-----------|
| Frontend | Single `index.html` — vanilla JS ES modules, hash router, CSS design tokens |
| Auth | Firebase Authentication (Email/Password) |
| Database | Cloud Firestore (Spark plan / Native mode) |
| Offline | Inline Service Worker (Blob URL) — cache-first for HTML, network-first for Firebase APIs |
| Hosting | Netlify (CDN, SPA redirect, custom headers) |
| CI/CD | GitHub Actions — push to `main` deploys both Netlify and Firebase |
| Calendar | Ethiopian Calendar (EC) built-in — dates stored as EC strings / GC Timestamps |
| Localization | English + Amharic (አማርኛ) toggle |

---

## Roles

| Role | Description |
|------|-------------|
| `admin` | Full access — user management, school config, all reports |
| `registrar` | Student enrollment, parent invites, tuition payments, announcements |
| `teacher` | Gradebook, homework for assigned classes |
| `homeroom_teacher` | Same as teacher + attendance marking for their homeroom class |
| `parent` | Read-only — own children's grades, attendance, homework, fees |
| `student` | Read-only — own grades, attendance, homework, fees, exam schedule |

---

## Troubleshooting

**Rules gate banner still red after deployment**  
Run `firebase deploy --only firestore:rules --project school-erp-et` manually
and reload the app. The banner clears automatically once the rules are live.

**`FIREBASE_TOKEN` not working with firebase-tools v13+**  
Generate a new token with `firebase login:ci` using the installed CLI version,
or switch to [Workload Identity Federation](https://firebase.google.com/docs/cli#use-workload-identity-federation).

**Netlify shows 404 on direct URL access**  
Confirm `netlify.toml` is at the repository root and the `[[redirects]]` block
(`/* → /index.html` with status 200) is present and has been deployed.

**Budget warning banner appears immediately after first login**  
The Spark plan allows 50,000 reads/day. The first admin session reads
`schoolConfig/main`, the user doc, and several list views — this is normal.
If the soft-budget counter is already at the warning threshold from testing,
click **Admin → Budget pill (top-right) → Reset Counter** to zero today's count.

**`firestore.indexes.json` deploy fails with "comment not allowed"**  
The `//` comments in `firestore.indexes.json` are for human readability here.
If the Firebase CLI rejects them, strip the comment lines before deploying:
```bash
grep -v '^\s*//' firestore.indexes.json > firestore.indexes.clean.json
mv firestore.indexes.clean.json firestore.indexes.json
firebase deploy --only firestore:indexes
```
