// Asks the website to email an invitation the database has already accepted.
//
// The launcher cannot send this itself. Sending needs a Resend API key, and
// anything this renderer can read is inside a bundle that ships to users -- Vite
// inlines every VITE_* variable into it. So the key lives on the website and the
// launcher asks.
//
// The invite exists before this is called. `create_org_invite` mints the token
// and reserves the seat in its own round trip, and that one is the transaction
// that matters: if this call fails the invite is still valid and the dialog
// still shows the link, which is exactly how invites worked before any email
// existed. Nothing here is allowed to undo that.
//
// The vocabulary below mirrors landing/lib/dashboard/inviteSend.ts -- the same
// route answers both callers, so they must say the same things about the same
// failures. The two repositories cannot share a module; this is the same
// arrangement team/limit.ts has with the website's lib/dashboard/seats.ts.
import {SITE_URL} from './auth';
import {supabase} from '../supabase';

// `send_failed`, `unreachable` and `throttled` leave a perfectly good invite
// behind, so the dialog offers the link for those. The rest describe an invite
// that cannot be delivered at all, where handing over a URL would give the owner
// something that fails for their teammate rather than for them.
export type InviteEmailFailure =
  | 'not_signed_in'
  | 'throttled'
  | 'send_failed'
  | 'unreachable'
  | 'not_found'
  | 'not_pending'
  | 'expired'
  | 'unauthorized'
  | 'server_error';

export type InviteEmailResult =
  | {ok: true}
  | {ok: false; reason: InviteEmailFailure; message: string};

const LINK_WORTH_SHOWING: ReadonlySet<InviteEmailFailure> = new Set<InviteEmailFailure>([
  'send_failed',
  'unreachable',
  'throttled',
  // Nothing reached the server, so the owner is the only delivery path left.
  'not_signed_in',
]);

// Whether the dialog should fall back to showing the link for this failure.
export function linkStillWorthShowing(result: InviteEmailResult): boolean {
  return !result.ok && LINK_WORTH_SHOWING.has(result.reason);
}

// Exported for its test. The interesting property is not any one sentence, it
// is that no two of these codes collapse into the same one -- which is what the
// old `return false` did to all of them.
export function describeSendResponse(
    status: number, body: {error?: string; retryAfterSeconds?: number} | null,
): InviteEmailResult {
  if (status === 429) {
    const seconds = body?.retryAfterSeconds ?? 60;
    return {
      ok: false,
      reason: 'throttled',
      message: `Already sent moments ago — try again in ${seconds}s.`,
    };
  }
  switch (body?.error) {
    case 'unauthorized':
      return {ok: false, reason: 'unauthorized', message: 'Your session expired. Sign in again.'};
    case 'invite_not_found':
      // The route answers 404 for "not yours" as well as "does not exist", on
      // purpose, so this must not claim to know which.
      return {ok: false, reason: 'not_found', message: 'That invitation no longer exists.'};
    case 'invite_accepted':
      return {ok: false, reason: 'not_pending', message: 'They have already joined.'};
    case 'invite_revoked':
      return {ok: false, reason: 'not_pending', message: 'That invitation was revoked.'};
    case 'invite_expired':
      return {
        ok: false,
        reason: 'expired',
        message: 'That invitation has expired. Revoke it and invite them again.',
      };
    case 'send_failed':
      // What an unset RESEND_API_KEY on the website looks like from here. Worth
      // its own sentence: it is the one failure an operator can act on.
      return {
        ok: false,
        reason: 'send_failed',
        message: 'The mail service refused the message.',
      };
    default:
      return {
        ok: false,
        reason: 'server_error',
        message: 'Something went wrong on the website’s end.',
      };
  }
}

// The website authorises the send from the caller's own session -- every policy
// on org_invites is is_org_owner, so RLS decides whether this token is theirs to
// send. The access token is what carries that identity across; there is no
// cookie shared between a file:// renderer and browserargus.com.
//
// Never throws. Every caller has already committed an invite row.
export async function sendInviteEmail(token: string): Promise<InviteEmailResult> {
  if (!supabase) {
    return {ok: false, reason: 'not_signed_in', message: 'You are not signed in.'};
  }
  try {
    const {data} = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return {ok: false, reason: 'not_signed_in', message: 'You are not signed in.'};
    }
    const response = await fetch(`${SITE_URL}/api/invites/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({token}),
    });
    const body = (await response.json().catch(() => null)) as
      | {ok?: boolean; error?: string; retryAfterSeconds?: number}
      | null;
    if (response.ok && body?.ok) {
      return {ok: true};
    }
    return describeSendResponse(response.status, body);
  } catch {
    // Offline, DNS, or the site being down. Reported as "we could not email it,
    // here is the link" rather than as an error, because the invite itself is
    // fine and the link still works.
    return {
      ok: false,
      reason: 'unreachable',
      message: 'We couldn’t reach the website.',
    };
  }
}
