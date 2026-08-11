// The website's send route answers this app and the dashboard with the same
// codes, so the two have to say the same things about them. This is the
// launcher's half; landing/lib/dashboard/inviteSend.test.ts is the other, the
// same arrangement team/limit.test.ts has with the website's seat arithmetic.
//
// What is actually being defended: every failure here used to be `return false`.
// A website deployed without its Resend key, an expired invitation and a
// 60-second throttle all produced one sentence, so a broken mailer looked
// exactly like a working one from the invite dialog.
import {describe, expect, it} from 'vitest';

import {describeSendResponse, linkStillWorthShowing} from './inviteEmail';

describe('describeSendResponse', () => {
  it('reads the wait off a 429 rather than assuming it', () => {
    const result = describeSendResponse(429, {error: 'too_soon', retryAfterSeconds: 42});
    expect(result).toMatchObject({ok: false, reason: 'throttled'});
    expect(result.ok === false && result.message).toContain('42s');
  });

  it('falls back to the route’s 60s floor when the body is unreadable', () => {
    const result = describeSendResponse(429, null);
    expect(result.ok === false && result.message).toContain('60s');
  });

  it('reports a refused send as its own thing', () => {
    // This is what an unset RESEND_API_KEY on the website looks like from here.
    expect(describeSendResponse(502, {error: 'send_failed'})).toMatchObject({
      reason: 'send_failed',
    });
  });

  it('gives every documented error code a distinct sentence', () => {
    const codes = [
      [401, 'unauthorized'],
      [404, 'invite_not_found'],
      [409, 'invite_accepted'],
      [409, 'invite_revoked'],
      [409, 'invite_expired'],
      [502, 'send_failed'],
      [500, 'lookup_failed'],
    ] as const;
    const messages = codes.map(([status, error]) => {
      const result = describeSendResponse(status, {error});
      expect(result.ok).toBe(false);
      return result.ok === false ? result.message : '';
    });
    expect(new Set(messages).size).toBe(codes.length);
  });
});

describe('linkStillWorthShowing', () => {
  it('offers the link only for failures that leave a usable invitation', () => {
    // An expired or already-accepted invite still has a URL, but handing it to
    // the owner gives them something that fails for their teammate instead.
    expect(linkStillWorthShowing(describeSendResponse(502, {error: 'send_failed'}))).toBe(true);
    expect(linkStillWorthShowing(describeSendResponse(429, null))).toBe(true);
    expect(linkStillWorthShowing(describeSendResponse(409, {error: 'invite_expired'}))).toBe(false);
    expect(linkStillWorthShowing(describeSendResponse(409, {error: 'invite_revoked'}))).toBe(false);
    expect(linkStillWorthShowing(describeSendResponse(404, {error: 'invite_not_found'}))).toBe(false);
  });

  it('says nothing to show for a send that succeeded', () => {
    expect(linkStillWorthShowing({ok: true})).toBe(false);
  });
});
