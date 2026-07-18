// Central place for every X DOM selector the extension depends on.
// When X ships a markup change, this is the only file to update.
window.ZINOLT_SELECTORS = {
  // Root of a single tweet in any timeline / thread / search view.
  article: 'article[data-testid="tweet"]',

  // Action-row group holding reply / retweet / like / bookmark / share.
  actionRow: 'div[role="group"][id]',

  // Timestamp <time> inside the anchor that points at /{handle}/status/{id}.
  statusTimeAnchor: 'a[role="link"][href*="/status/"] time',

  // Anchor whose href starts with "/{handle}" and links to the author.
  userNameAnchor: '[data-testid="User-Name"] a[role="link"][href^="/"]',

  // Tweet body text container. May be missing on media-only tweets.
  tweetText: '[data-testid="tweetText"]',

  // Media presence markers (any one match = has_media = true).
  photo: '[data-testid="tweetPhoto"]',
  video: '[data-testid="videoComponent"], [data-testid="videoPlayer"]',
  gifAudioIndicator: '[aria-label="Embedded video"]',

  // Action buttons — used to read counts and to locate the injection point.
  likeButton: '[data-testid="like"], [data-testid="unlike"]',
  retweetButton: '[data-testid="retweet"], [data-testid="unretweet"]',
  replyButton: '[data-testid="reply"]',

  // Analytics link (only rendered on some views) — carries view count text.
  analyticsAnchor: 'a[href$="/analytics"]',
};
