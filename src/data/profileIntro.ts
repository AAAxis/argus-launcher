// The three screens shown to someone who has never made a profile.
//
// Content lives here rather than in the modal for the same reason
// Integration.steps does: it is copy, it will be rewritten more often than the
// component, and keeping it out means the modal is only navigation.
//
// `figure` names the screenshot each step will eventually carry. The files do
// not exist yet -- the modal draws a labelled placeholder at the right aspect
// ratio in the meantime, so dropping them in later moves no layout.
// Shared with data/cookieIntro.ts -- IntroModal renders both from this shape.
export type IntroStep = {
  title: string;
  body: string;
  // Short line under the figure. Says what the picture shows, so the step still
  // makes sense while the picture is a placeholder.
  caption: string;
  figure: string;
  // The screenshot itself, once one exists. Omitted while `figure` is still only
  // a name: the modal then draws its labelled placeholder at the same aspect
  // ratio, so the two kinds of step sit at the same height in the same dialog.
  image?: string;
};

export const PROFILE_INTRO_STEPS: IntroStep[] = [
  {
    title: 'A profile is a whole separate browser',
    body: 'Each one keeps its own cookies, storage, history and logins in its own folder ' +
      'on disk. Two profiles never see each other, so you can stay signed in to a dozen ' +
      'accounts on the same site at once without any of them noticing the others.',
    caption: 'Every profile in your workspace, side by side.',
    figure: 'profiles-list',
  },
  {
    title: 'Give it an identity',
    body: 'The platform and fingerprint decide what a site sees — the operating system, ' +
      'the GPU, the screen, the timezone. The proxy decides where it appears to be. ' +
      'Argus keeps those consistent for you: pick a platform and the rest of the ' +
      'hardware is re-rolled to match it.',
    caption: 'The platform picker and the fingerprint it drives.',
    figure: 'profile-identity',
  },
  {
    title: 'Launch, then keep it organised',
    body: 'Launch opens Argus Browser on that identity. As the list grows, folders group ' +
      'profiles, statuses track where each one stands, and colours and tags make a row ' +
      'findable at a glance. Deleted profiles wait in Trash for 30 days before they go.',
    caption: 'Folders, statuses and tags on a full workspace.',
    figure: 'profiles-organised',
  },
];
