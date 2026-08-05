// "Who is this workspace for?" -- asked once, on the first run of a workspace
// nobody has answered for.
//
// The desktop half of the website's /onboarding page. Both exist because both
// can create an account: the website has signup, and the launcher's sign-in
// screen also creates one on first code ("No password needed -- entering your
// email creates your account"). Whichever one a person arrives through, the
// question is asked once and the answer is the same row.
//
// The two are deliberately NOT a shared component -- separate repos, different
// React versions, different styling systems -- but they are the same two steps
// in the same order, they write the same columns, and they use the same gate
// (organizations.onboarded_at). Change one, change the other.
//
// What it does NOT do: gate anything. Every field except the first question is
// optional, "Not now" is always available, and nothing here changes a limit or a
// price. A workspace that skips it is a workspace with nulls in six columns, not
// a degraded one.
import {useMemo, useRef, useState} from 'react';
import {Building2, ImageUp, User} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {countryChoices} from '../../data/folderIcons';
import * as db from '../../db';
import {LOGO_MAX_BYTES, uploadOrgLogo} from '../../db/orgLogo';
import type {OrgType} from '../../types';

export function WorkspaceSetupModal({orgId, orgName, onDone}: {
  orgId: string;
  orgName: string;
  // Called once the row is written, or once the user declines. Either way the
  // prompt does not come back -- both paths stamp onboarded_at.
  onDone: () => void;
}) {
  const countries = useMemo(() => countryChoices(), []);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Whether the workspace still carries the name bootstrap_org derived from the
  // signup address ("gmail.com team"), captured at mount.
  //
  // In a useState initialiser, not a render-time expression, because `save`
  // writes `name` and the answer has to be the one from BEFORE that write --
  // otherwise editing the business name a second time would re-adopt it over a
  // workspace name the user had since chosen.
  //
  // Mount is a safe moment to read it: App only renders this component once
  // org.ready is true, so `orgName` is the real row rather than the undefined of
  // a first fetch.
  const [autoNamed] = useState(() => looksAutoNamed(orgName));

  const [step, setStep] = useState<'type' | 'details'>('type');
  const [legalName, setLegalName] = useState('');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(orgType: OrgType, details: boolean) {
    setBusy(true);
    setError('');
    try {
      const name = legalName.trim();
      await db.orgs.updateProfile(orgId, {
        org_type: orgType,
        // A solo workspace leaves these null rather than writing empty strings,
        // so "not asked" and "asked and skipped" stay different in the data.
        legal_name: details ? name || null : null,
        country: details ? country || null : null,
        website: details ? normalizeWebsite(website) || null : null,
        logo_url: details ? logoUrl || null : null,
        onboarded_at: new Date().toISOString(),
        // Adopt the business name as the workspace name, but only while the
        // workspace still has the one derived from the email address -- the
        // "gmail.com team" default. A workspace somebody deliberately renamed is
        // never overwritten by a form about the company behind it.
        ...(details && name && autoNamed ? {name} : {}),
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  }

  // Recorded as answered even when they decline, and deliberately: the prompt
  // has no second entry point, so re-asking on every launch is the only
  // alternative and that is nagging. Settings has the same fields for anyone who
  // changes their mind.
  async function notNow() {
    setBusy(true);
    setError('');
    try {
      await db.orgs.updateProfile(orgId, {onboarded_at: new Date().toISOString()});
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError('That image is larger than 2 MB. Pick a smaller one.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setLogoUrl(await uploadOrgLogo(orgId, file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload that image.');
    } finally {
      setBusy(false);
      // Same file twice in a row fires onChange only if the value is cleared,
      // so a failed upload could not otherwise be retried with that file.
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  }

  if (step === 'type') {
    return (
      <Modal
        className="small-modal"
        onClose={() => void notNow()}
        title="Who is this workspace for?"
        subtitle="It helps us understand who we build for. It does not change your plan."
        footer={
          <button className="ghost" disabled={busy} onClick={() => void notNow()} type="button">
            Not now
          </button>
        }
      >
        <div className="setup-choices">
          <button
            className="setup-choice"
            disabled={busy}
            onClick={() => void save('solo', false)}
            type="button"
          >
            <User size={20} strokeWidth={1.75} />
            <strong>Just me</strong>
            <span>I work on my own account, as a freelancer or independently.</span>
          </button>
          <button
            className="setup-choice"
            disabled={busy}
            onClick={() => {
              setError('');
              setStep('details');
            }}
            type="button"
          >
            <Building2 size={20} strokeWidth={1.75} />
            <strong>A business</strong>
            <span>I work for a company or an agency, or I run one.</span>
          </button>
        </div>
        {error && <p className="setup-error">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      className="small-modal"
      onClose={() => void notNow()}
      title="Tell us about your business"
      subtitle="All optional. The name and logo appear here and on the Team tab."
      footer={
        <>
          <button className="ghost" disabled={busy} onClick={() => setStep('type')} type="button">
            Back
          </button>
          <button disabled={busy} onClick={() => void save('business', true)} type="button">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {/* .field is the app's own label+control primitive (styles.css:5849) --
          it carries the label weight, the gap and the 36px control height that
          every other dialog uses, so these rows match the profile editor and
          Settings without a second set of form styles to keep in step. */}
      <div className="setup-fields">
        <label className="field">
          <span>Business name</span>
          <input
            autoFocus
            maxLength={120}
            onChange={(event) => setLegalName(event.target.value)}
            placeholder="Acme Ltd"
            type="text"
            value={legalName}
          />
        </label>

        <label className="field">
          <span>Country</span>
          <select onChange={(event) => setCountry(event.target.value)} value={country}>
            <option value="">Select a country…</option>
            {countries.map((choice) => (
              <option key={choice.code} value={choice.code}>{choice.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Website</span>
          <input
            maxLength={200}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="acme.com"
            type="text"
            value={website}
          />
        </label>

        {/* Not a .field: the control is a picture and two buttons, not an
            input, so it borrows the label and lays its own row out. */}
        <div className="field setup-logo">
          <span>Logo</span>
          <div className="setup-logo-row">
            {logoUrl ?
              <img alt="" className="setup-logo-preview" src={logoUrl} /> :
              <span className="setup-logo-preview is-empty" aria-hidden="true" />}
            <input
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              onChange={(event) => void pickLogo(event.target.files?.[0])}
              ref={fileRef}
              type="file"
            />
            <button className="ghost" disabled={busy} onClick={() => fileRef.current?.click()} type="button">
              <ImageUp size={15} /> {logoUrl ? 'Change' : 'Upload'}
            </button>
            {logoUrl && (
              <button className="ghost" disabled={busy} onClick={() => setLogoUrl('')} type="button">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="setup-error">{error}</p>}
    </Modal>
  );
}

// Whether this is still the name bootstrap_org derived from the signup address.
//
// Matched by pattern rather than asserted: bootstrap_org lives only in the
// database, not in this repo, so this recognises the shape it produces --
// "gmail.com team", "acme.co.uk team" -- and errs toward leaving `name` alone
// when it does not match. Mirrors looksAutoNamed in landing/lib/org-profile.ts;
// the two must agree or the same account gets different behaviour on the two
// surfaces.
function looksAutoNamed(name: string | null | undefined): boolean {
  if (!name?.trim()) {
    return true;
  }
  return /^[^\s@]+\.[a-z]{2,}\s+team$/i.test(name.trim());
}

// Someone typing their own site writes "acme.com". The column's CHECK requires a
// scheme, so supply the one they meant rather than refusing the answer over
// punctuation.
function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
