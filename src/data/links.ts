import type {PlanKey} from '../plans';

// Pages on the marketing site the app links out to.
//
// Named here rather than spelled inline because the app had been linking to a
// route that does not exist: the API tab's "API docs" button opened
// `${SITE_URL}/docs/api`, and the landing site has no `/docs` segment at all
// (its routes are checkout, faq, go, how-it-works, join, login, privacy, signup,
// support, terms, thank-you, dashboard, admin). It had been a 404 for as long as
// the button had existed, because nothing in either repo checks the other's
// routes.
//
// When real documentation ships, change it here and every button follows.
export const SITE_LINKS = {
  docs: '/how-it-works',
  pricing: '/#pricing',
  support: '/support',
  // The API reference on the website. The launcher used to carry its own API
  // tab; that surface (endpoints, curl examples, key management) now lives on
  // the site, and the Integrations tab links here instead.
  api: '/api-reference',
  // The buy button on a plan card. Lands on a page that names the plan, the
  // price and the account about to be charged, then posts to /api/checkout --
  // which is where the amount is derived server-side, so the launcher never
  // carries a price into a URL.
  //
  // Signed-out visitors bounce through /login?next= and come back here, so the
  // app does not have to know or care whether the browser has a session.
  checkout: (plan: PlanKey) => `/checkout/${plan}`,
} as const;
