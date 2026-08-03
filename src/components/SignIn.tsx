import {Shield} from 'lucide-react';
import {GoogleMark} from './ui/icons';
import {OTP_CODE_LENGTH} from '../lib/auth';
import type {SignIn as SignInState} from '../hooks/useSignIn';

export function SignIn({state}: {state: SignInState}) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <Shield size={34} />
        {state.step === 'email' ? <EmailStep state={state} /> : <CodeStep state={state} />}
      </section>
    </main>
  );
}

function EmailStep({state}: {state: SignInState}) {
  return (
    <>
      <h1>Sign in to Argus Launcher</h1>
      <p>Cloud account required for profiles, proxies, bookmarks, and shared extensions.</p>
      <button
        type="button"
        className="google-button"
        onClick={() => void state.signInWithGoogle()}
        disabled={state.busy}
      >
        <GoogleMark />
        Continue with Google
      </button>
      <div className="login-divider">
        <span />or<span />
      </div>
      <form className="login-form" onSubmit={(event) => void state.requestCode(event)}>
        <input
          value={state.email}
          onChange={(event) => state.setEmail(event.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="username"
          autoFocus
          required
        />
        <button type="submit" disabled={state.busy}>
          {state.busy ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
      {state.error && <span className="message error">{state.error}</span>}
      <div className="login-links">
        <span className="hint">No password needed — entering your email creates your account.</span>
      </div>
    </>
  );
}

// Google and the divider are deliberately absent here: offering a second way in
// halfway through one flow is how people end up with two half-finished attempts
// and neither completed.
function CodeStep({state}: {state: SignInState}) {
  return (
    <>
      <h1>Check your email</h1>
      <p>We sent a {OTP_CODE_LENGTH}-digit code to {state.email}.</p>
      <form className="login-form" onSubmit={(event) => void state.verifyCode(event)}>
        <input
          type="text"
          className="otp-code"
          value={state.code}
          onChange={(event) =>
            state.setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))}
          placeholder={`${OTP_CODE_LENGTH}-digit code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_CODE_LENGTH}
          autoFocus
          required
        />
        <button type="submit" disabled={state.busy}>
          {state.busy ? 'Verifying…' : 'Verify and sign in'}
        </button>
      </form>
      {state.error && <span className="message error">{state.error}</span>}
      {!state.error && state.notice && <span className="message">{state.notice}</span>}
      <div className="login-links">
        <button
          type="button"
          className="link"
          onClick={() => void state.requestCode()}
          disabled={state.busy || state.cooldown > 0}
        >
          {state.cooldown > 0 ? `Resend code (${state.cooldown}s)` : 'Resend code'}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link" onClick={state.backToEmailStep}>
          Use a different email
        </button>
      </div>
    </>
  );
}
