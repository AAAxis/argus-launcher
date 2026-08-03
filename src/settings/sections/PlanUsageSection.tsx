// Plan & usage: what the workspace is entitled to, and how much of it is gone.
//
// Read-only by design. Every column shown here (plan, the limits, billing
// status) is service-role only -- 0002 re-granted UPDATE on organizations for
// (name, built_in_extensions) and nothing else -- so a client cannot change any
// of it, and the buttons go to the website's checkout rather than pretending
// otherwise.
import {useEffect, useState} from 'react';
import {ExternalLink} from 'lucide-react';
import * as db from '../../db';
import {formatDate} from '../../lib/text';
import {useOrg} from '../../org';
import {hasUpgrade, planLabel, planPrice} from '../../plans';
import {SettingsGroup, SettingsRow, SettingsValue} from '../rows';

type Props = {
  profileCount: number;
  onOpenSite: (pathname: string) => void;
};

function Meter({used, limit}: {used: number; limit: number | null}) {
  // A null limit is Enterprise's "unlimited": there is no denominator, so there
  // is no bar to fill -- showing a full one would read as "at your limit".
  if (limit === null || limit <= 0) {
    return (
      <div className="settings-meter">
        <strong>{used}</strong>
        <span>of unlimited</span>
      </div>
    );
  }
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="settings-meter">
      <div className="settings-meter-numbers">
        <strong>{used}</strong>
        <span>of {limit}</span>
      </div>
      <div className="settings-meter-track" aria-hidden="true">
        <span className={percent >= 100 ? 'full' : ''} style={{width: `${percent}%`}} />
      </div>
    </div>
  );
}

export function PlanUsageSection({profileCount, onOpenSite}: Props) {
  const org = useOrg();
  const [seats, setSeats] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const orgId = org.orgId;
    if (!orgId) {
      setSeats(null);
      return;
    }
    void db.orgs.countMembers(orgId)
        .then((count) => {
          if (!cancelled) {
            setSeats(count);
          }
        })
        // The meter is the only thing that needs this number; a failure shows
        // "—" rather than taking the whole section down with it.
        .catch(() => {
          if (!cancelled) {
            setSeats(null);
          }
        });
    return () => {
      cancelled = true;
    };
  }, [org.orgId]);

  const plan = org.org?.plan;
  const price = planPrice(plan);
  const status = org.org?.billing_status || '';
  const periodEnd = formatDate(org.org?.current_period_end);
  const ending = status === 'canceled' || status === 'cancelled';

  return (
    <>
      <SettingsGroup>
        <div className="settings-plan">
          <div>
            <span className="settings-plan-name">{planLabel(plan)}</span>
            {status && <span className={`settings-plan-status ${ending ? 'ending' : ''}`}>{status}</span>}
            <p>
              {price === null || price === 0 ? 'No charge' : `$${price} per month`}
              {periodEnd ? ` · ${ending ? 'ends' : 'renews'} ${periodEnd}` : ''}
            </p>
          </div>
          <div className="settings-plan-actions">
            {hasUpgrade(plan) && (
              <button onClick={() => onOpenSite('/dashboard')} type="button">
                Upgrade plan
              </button>
            )}
            <button className="ghost" onClick={() => onOpenSite('/dashboard')} type="button">
              <ExternalLink size={15} /> Manage billing
            </button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Usage">
        <SettingsRow
          label="Profiles"
          description="Profiles in Trash don't count against the limit until you restore them."
        >
          <Meter used={profileCount} limit={org.org?.profile_limit ?? null} />
        </SettingsRow>

        <SettingsRow label="Members" description="People who can sign in to this workspace.">
          {seats === null ?
            <SettingsValue>—</SettingsValue> :
            <Meter used={seats} limit={org.org?.seat_limit ?? null} />}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Billing">
        <SettingsRow
          label="Invoices and payment method"
          description="Plans are billed monthly through Revolut on the website."
        >
          <button className="ghost" onClick={() => onOpenSite('/dashboard')} type="button">
            <ExternalLink size={15} /> Open dashboard
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
