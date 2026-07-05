// Feature keys are sent to the server and used to group feedback for analysis.
// NEVER rename a key once it has shipped, or historical feedback will be split
// across the old and new names.
export const FEEDBACK_FEATURES = {
  "git-sync": "How is Git sync working for you?",
} as const;

export type FeedbackFeature = keyof typeof FEEDBACK_FEATURES;
