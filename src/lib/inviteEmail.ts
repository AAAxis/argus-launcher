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
import {SITE_URL} from './auth';
import {supabase} from '../supabase';

// The website authorises the send from the caller's own session -- every policy
// on org_invites is is_org_owner, so RLS decides whether this token is theirs to
// send. The access token is what carries that identity across; there is no
// cookie shared between a file:// renderer and browserargus.com.
export async function sendInviteEmail(token: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }
  try {
    const {data} = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return false;
    }
    const response = await fetch(`${SITE_URL}/api/invites/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({token}),
    });
    return response.ok;
  } catch {
    // Offline, DNS, or the site being down. Reported to the user as "we could
    // not email it, here is the link" rather than as an error, because the
    // invite itself is fine and the link still works.
    return false;
  }
}
