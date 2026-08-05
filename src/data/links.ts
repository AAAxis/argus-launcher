// Pages on the marketing site the app links out to.
//
// Named here rather than spelled inline because the app had been linking to a
// route that does not exist: the API tab's "API docs" button opened
// `${SITE_URL}/docs/api`, and the landing site has no `/docs` segment at all
// (its routes are faq, go, how-it-works, login, privacy, signup, support,
// terms, thank-you, dashboard, admin). It had been a 404 for as long as the
// button had existed, because nothing in either repo checks the other's routes.
//
// When real documentation ships, change it here and every button follows.
export const SITE_LINKS = {
  docs: '/how-it-works',
  pricing: '/#pricing',
  support: '/support',
} as const;
