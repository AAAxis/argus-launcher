// The plan picker, shown only to a workspace that is still on Free.
//
// It leads with what the workspace has already used rather than with the cards,
// because that is the honest version of the pitch: "3 of 5 profiles" is an
// argument, and a grid of prices is not. The tab disappears the moment a plan is
// bought (see showsPlanPicker in src/plans.ts), so there is no "current plan"
// card here -- Free is always the current plan, and it is the strip at the top.
//
// Nothing here can change a plan. Every column that decides one is service-role
// only in Postgres, so the buttons open the website's checkout, which is the only
// place an order can be created. Same reasoning as the header of
// settings/sections/PlanUsageSection.tsx.
import {ArrowUpRight, Check, Workflow, Monitor, Users} from 'lucide-react';
import type {ReactNode} from 'react';
import {Meter} from '../ui/Meter';
import {SITE_LINKS} from '../../data/links';
import {useOrg} from '../../org';
import {PAID_PLANS, PLANS} from '../../plans';
import type {PlanInfo} from '../../plans';

type Props = {
  profileCount: number;
  automationCount: number;
  memberCount: number;
  onOpenSite: (pathname: string) => void;
};

export function PlansTab({profileCount, automationCount, memberCount, onOpenSite}: Props) {
  const org = useOrg();

  return (
    <section className="plans-tab">
      <header className="plans-head">
        <h2>Choose your plan</h2>
        <p>
          You&apos;re on Free. Every plan below is the same app with more room in it —
          more profiles, more people, more automations.
        </p>
      </header>

      {/* The strip, not a Free card. A card would invite a comparison the reader
        * has already made -- they are on Free -- where the meters answer the
        * question they actually have, which is how much of it is left. */}
      <section className="plans-current">
        <span className="plans-current-tag">Free · your plan</span>
        <div className="plans-current-meters">
          <PlanUsage
            icon={<Monitor size={15} strokeWidth={1.75} />}
            label="Profiles"
            used={profileCount}
            limit={org.org?.profile_limit ?? null}
          />
          <PlanUsage
            icon={<Workflow size={15} strokeWidth={1.75} />}
            label="Automations"
            used={automationCount}
            limit={org.org?.automation_limit ?? null}
          />
          <PlanUsage
            icon={<Users size={15} strokeWidth={1.75} />}
            label="Members"
            used={memberCount}
            limit={org.org?.seat_limit ?? null}
          />
        </div>
      </section>

      <div className="plans-grid">
        {PAID_PLANS.map((plan) => (
          <PlanCard key={plan.key} plan={plan} onChoose={() => onOpenSite(SITE_LINKS.checkout(plan.key))} />
        ))}
      </div>

      <footer className="plans-foot">
        <p>
          Bought through Revolut on the website, 30 days at a time — nothing renews
          automatically and nothing is charged again unless you buy it again. Your new
          limits reach this app as soon as the payment clears; there is nothing to
          reinstall.
        </p>
        <button className="ghost" onClick={() => onOpenSite(SITE_LINKS.pricing)} type="button">
          Compare on the website <ArrowUpRight size={15} />
        </button>
      </footer>
    </section>
  );
}

// The name rides inside the meter rather than above it, so each entitlement is
// two rows and not three: "Profiles ... 0 of 5" on one line, the track under
// both. See the `label` note in components/ui/Meter.tsx.
function PlanUsage({icon, label, used, limit}: {
  icon: ReactNode;
  label: string;
  used: number;
  limit: number | null;
}) {
  return <Meter label={<>{icon}{label}</>} used={used} limit={limit} />;
}

function PlanCard({plan, onChoose}: {plan: PlanInfo; onChoose: () => void}) {
  // Rendered for every card, filled for the two that carry a ribbon. The ribbon
  // is attached above the card rather than sitting inside it, so an empty one is
  // what keeps the three card tops on a line -- dropping the element for Base
  // would leave it standing taller than the plans being recommended.
  const carriedFrom = plan.carriesOver ? PLANS[plan.carriesOver] : null;

  return (
    <div className="plan-slot">
      <div className={plan.ribbon ? 'plan-ribbon is-shown' : 'plan-ribbon'} aria-hidden={!plan.ribbon}>
        {plan.ribbon ?? ''}
      </div>

      <article className={plan.ribbon ? 'plan-card is-highlighted' : 'plan-card'}>
        <h3>{plan.label}</h3>
        <p className="plan-tagline">{plan.tagline}</p>

        <p className="plan-price">
          <strong>${plan.priceMonthly}</strong>
          <span>/30 days</span>
        </p>

        <ul className="plan-features">
          {carriedFrom && (
            // Not a tick: it is a heading for the list, not a member of it.
            <li className="plan-carried">Everything in {carriedFrom.label}, and:</li>
          )}
          {plan.features.map((feature, index) => (
            <li className={index === 0 ? 'is-lead' : ''} key={feature}>
              <Check size={15} strokeWidth={2.25} />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* Filled on the two recommended tiers, outlined on Base. Three
          * identical fills would make the recommendation invisible; two fills
          * against one ghost still reads as "these are the plans, and that is
          * the way in", which is the split the page is arguing for. */}
        <button
          className={plan.ribbon ? 'plan-cta' : 'plan-cta ghost'}
          onClick={onChoose}
          type="button"
        >
          Choose {plan.label}
        </button>
      </article>
    </div>
  );
}
