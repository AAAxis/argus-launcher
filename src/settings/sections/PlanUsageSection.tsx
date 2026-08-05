// Plan & usage: what the workspace is entitled to, and how much of it is gone.
//
// Read-only by design. Every column shown here (plan, the limits, billing
// status) is service-role only -- 0002 re-granted UPDATE on organizations for
// (name, built_in_extensions) and nothing else -- so a client cannot change any
// of it, and the buttons go to the website's checkout rather than pretending
// otherwise.
//
// This is also the only plan screen a PAYING workspace has: the Plans tab exists
// to sell the first paid plan and disappears once one is bought (see
// showsPlanPicker in src/plans.ts). So "what you are on" and "what that
// includes" both have to be answerable here, not only "how much is left".
import {useEffect, useState} from 'react';
import {
  Cloud, ExternalLink, Monitor, Receipt, ShieldCheck, SquareTerminal, Users, Workflow,
} from 'lucide-react';
import type {ReactNode} from 'react';
import * as db from '../../db';
import {Badge} from '../../components/ui/Badge';
import type {BadgeTone} from '../../components/ui/Badge';
import {Meter} from '../../components/ui/Meter';
import {formatDate} from '../../lib/text';
import {useOrg} from '../../org';
import {hasUpgrade, isPlanKey, PLANS, planLabel, planPrice, showsPlanPicker} from '../../plans';
import {seatCap} from '../../team/limit';
import type {ArgusOrg} from '../../types';
import {SettingsGroup, SettingsRow, SettingsValue} from '../rows';

type Props = {
  profileCount: number;
  automationCount: number;
  onOpenSite: (pathname: string) => void;
  // Closes Settings and lands on the Plans tab. Only offered while that tab
  // exists -- a free workspace. A paying one is sent to the website, which is
  // where an existing subscription is changed or cancelled.
  onOpenPlans: () => void;
};

export function PlanUsageSection({profileCount, automationCount, onOpenSite, onOpenPlans}: Props) {
  const org = useOrg();
  // Members AND the invites already sent, because those are what the seat limit
  // is compared against.
  //
  // This used to be countMembers() alone, which made Settings and the Team tab
  // disagree about the same workspace -- "1 of 5" here beside "4 of 5" there.
  // create_org_invite reserves a seat the moment an invite is minted, so the
  // Team tab was the correct one; this now computes the same pair through the
  // same seatCap() helper so there is one answer rather than two.
  const [seatUse, setSeatUse] = useState<{members: number; invites: number} | null>(null);

  useEffect(() => {
    let cancelled = false;
    const orgId = org.orgId;
    if (!orgId) {
      setSeatUse(null);
      return;
    }
    // Both counts together: a meter that showed members before invites arrived
    // would tick upward on load, which reads as the number being unreliable.
    //
    // countLiveInvites returns 0 for a member rather than failing -- every
    // policy on org_invites is is_org_owner -- so a member sees their own
    // membership count and no invites, which is everything they are allowed to
    // know. The row's description says so.
    void Promise.all([db.orgs.countMembers(orgId), db.team.countLiveInvites(orgId)])
        .then(([members, invites]) => {
          if (!cancelled) {
            setSeatUse({members, invites});
          }
        })
        // The meter is the only thing that needs these; a failure shows "—"
        // rather than taking the whole section down with it.
        .catch(() => {
          if (!cancelled) {
            setSeatUse(null);
          }
        });
    return () => {
      cancelled = true;
    };
  }, [org.orgId]);

  // null until both counts land, so the meter shows "—" rather than a number
  // that is about to change.
  const cap = seatUse ? seatCap(org.org, seatUse.members, seatUse.invites) : null;

  const plan = org.org?.plan;
  const price = planPrice(plan);
  const status = org.org?.billing_status || '';
  const periodEnd = formatDate(org.org?.current_period_end);
  const ending = status === 'canceled' || status === 'cancelled';
  const onFreePlan = showsPlanPicker(plan);

  return (
    <>
      <SettingsGroup>
        <div className="settings-plan">
          <span className="settings-plan-mark" aria-hidden="true">
            <ShieldCheck size={20} strokeWidth={1.75} />
          </span>
          <div className="settings-plan-body">
            <div className="settings-plan-title">
              <span className="settings-plan-name">{planLabel(plan)}</span>
              {status && <Badge tone={billingTone(status)}>{status}</Badge>}
            </div>
            {/* Always "ends", never "renews". A purchase is a one-time Revolut
                order (landing/lib/revolut.ts) with no mandate behind it, so
                current_period_end is the date the plan stops -- not the date the
                card is charged again. `ending` still distinguishes a cancelled
                workspace, which is a different sentence. */}
            <p>
              {price === null || price === 0 ? 'No charge' : `$${price} for 30 days`}
              {periodEnd ? ` · ${ending ? 'cancelled, ends' : 'ends'} ${periodEnd}` : ''}
            </p>
          </div>
          <div className="settings-plan-actions">
            {hasUpgrade(plan) && (
              onFreePlan ?
                // The picker is one click away inside the app, so sending
                // someone to a browser to read the same three cards would be
                // the long way round to the same screen.
                <button onClick={onOpenPlans} type="button">See plans</button> :
                <button onClick={() => onOpenSite('/dashboard')} type="button">Upgrade plan</button>
            )}
            <button className="ghost" onClick={() => onOpenSite('/dashboard')} type="button">
              <ExternalLink size={15} /> Manage billing
            </button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup className="settings-plan-usage" title="Usage">
        <SettingsRow
          label="Profiles"
          icon={<Monitor size={16} strokeWidth={1.75} />}
          description="Profiles in Trash don't count against the limit until you restore them."
        >
          <Meter used={profileCount} limit={org.org?.profile_limit ?? null} />
        </SettingsRow>

        <SettingsRow
          label="Automations"
          icon={<Workflow size={16} strokeWidth={1.75} />}
          description="Saved workflows. Runs are unlimited; this is how many you can keep."
        >
          <Meter used={automationCount} limit={org.org?.automation_limit ?? null} />
        </SettingsRow>

        <SettingsRow
          label="Members"
          icon={<Users size={16} strokeWidth={1.75} />}
          description={org.isOwner ?
            'People here plus invites you have sent — an unaccepted invite still holds its seat. Manage them on the Team tab.' :
            'People who can sign in to this workspace. See them on the Team tab.'}
        >
          {cap === null ?
            <SettingsValue>—</SettingsValue> :
            <Meter used={cap.used} limit={cap.limit} />}
        </SettingsRow>
      </SettingsGroup>

      <IncludedGroup org={org.org} plan={plan} />

      <SettingsGroup title="Billing">
        <SettingsRow
          label="Invoices and payment method"
          icon={<Receipt size={16} strokeWidth={1.75} />}
          description="Plans are bought through Revolut on the website, 30 days at a time. Nothing renews automatically."
        >
          <button className="ghost" onClick={() => onOpenSite('/dashboard')} type="button">
            <ExternalLink size={15} /> Open dashboard
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

// null is unlimited -- the convention every limit column and every trigger in
// this schema follows.
function limitText(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unlimited' : String(value);
}

// What this workspace is entitled to, as tiles rather than prose.
//
// THESE ARE THE DATABASE'S NUMBERS, NOT src/plans.ts's. That distinction is the
// whole point of this component and it was got wrong until 2026-08-08: the tiles
// rendered PLANS[plan] -- the hand-kept marketing mirror -- directly above meters
// that render organizations.*_limit. When the two disagreed the same screen
// showed "Included in Enterprise: 1000 profiles, 25 people" over a meter reading
// "15 of 300", and the reader had no way to tell which number they had bought.
//
// The mirror cannot be the answer here, because it describes what the tier is
// *sold* as while the triggers enforce what the row *says*. A workspace whose
// limits were set by hand, or whose upgrade landed before
// apply_plan_entitlements existed (it did not exist until 2026-08-05, so every
// upgrade before then set plan and nothing else), has a row that disagrees with
// its own plan name. Showing the mirror hides that; showing the row surfaces it.
//
// Renders nothing until the org has loaded. An unrecognised plan string still
// gets its tiles -- unlike the mirror-driven version, these numbers do not
// depend on the plan being one this build knows about.
function IncludedGroup({org, plan}: {org: ArgusOrg | null | undefined; plan: string | null | undefined}) {
  if (!org) {
    return null;
  }

  // Only answerable for a plan this build knows. Deliberately compares against
  // the mirror rather than trusting it: this is the one place the disagreement
  // can be seen, so it is the one place worth reporting it.
  const info = isPlanKey(plan) ? PLANS[plan] : null;
  const mismatched = info !== null && (
    org.profile_limit !== info.profiles ||
    org.seat_limit !== info.seats ||
    org.automation_limit !== info.automations
  );

  return (
    <SettingsGroup title={`Included in ${planLabel(plan)}`}>
      <div className="settings-included">
        <IncludedTile
          icon={<Monitor size={16} strokeWidth={1.75} />}
          label="Browser profiles"
          value={limitText(org.profile_limit)}
        />
        <IncludedTile
          icon={<Users size={16} strokeWidth={1.75} />}
          label="People"
          value={org.seat_limit === 1 ? 'Just you' : limitText(org.seat_limit)}
        />
        <IncludedTile
          icon={<Workflow size={16} strokeWidth={1.75} />}
          label="Automations"
          value={limitText(org.automation_limit)}
        />
        <IncludedTile
          icon={<Cloud size={16} strokeWidth={1.75} />}
          label="Cloud sync"
          value="Included"
        />
        <IncludedTile
          icon={<SquareTerminal size={16} strokeWidth={1.75} />}
          label="Local API"
          value="Included"
        />
      </div>
      {mismatched && (
        // Said plainly rather than silently corrected. The app cannot fix this
        // itself -- every limit column is service-role only -- and a workspace
        // getting less than its plan sells is a billing problem, not a display
        // problem, so the only useful thing this screen can do is name it and
        // point at the people who can change it.
        <p className="settings-note">
          These are the limits set on your workspace, and they don&rsquo;t match what the{' '}
          {info?.label} plan includes ({info?.profiles} profiles, {info?.seats} people,{' '}
          {info?.automations} automations). Contact support and we&rsquo;ll put it right.
        </p>
      )}
    </SettingsGroup>
  );
}

function IncludedTile({icon, label, value}: {icon: ReactNode; label: string; value: string}) {
  return (
    <div className="settings-included-tile">
      <span className="settings-included-icon" aria-hidden="true">{icon}</span>
      <span className="settings-included-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// The status word Revolut and the admin tools write, in the app's tone
// vocabulary. A cancelled subscription is still active until the period ends, so
// it is warned about rather than shown as an error; a failed payment is the one
// that is.
function billingTone(status: string): BadgeTone {
  const value = status.toLowerCase();
  if (value === 'active' || value === 'trialing') {
    return 'active';
  }
  if (value === 'canceled' || value === 'cancelled') {
    return 'warmup';
  }
  if (value === 'past_due' || value === 'unpaid' || value === 'failed') {
    return 'ban';
  }
  return 'neutral';
}
