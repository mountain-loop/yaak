import { settingsAtom } from "@yaakapp-internal/models";
import { FeedbackToast } from "../components/FeedbackToast";
import { jotaiStore } from "./jotai";
import { getKeyValue, setKeyValue } from "./keyValueStore";
import { showToast } from "./toast";

// Feature keys are sent to the server and used to group feedback for analysis.
// NEVER rename a key once it has shipped, or historical feedback will be split
// across the old and new names.
export const FEEDBACK_FEATURES = {
  "cookie-editor": "How is cookie editing working for you?",
  "response-history": "How is the new response history menu working for you?",
  "sse-summary": "How is extracted text for event streams working for you?",
  "git-sync": "How is Git sync working for you?",
} as const;

export type FeedbackFeature = keyof typeof FEEDBACK_FEATURES;

interface FeatureFeedbackState {
  uses: number;
  done: boolean;
}

// Ask once the user has used a feature enough times to have formed an opinion
const PROMPT_AFTER_USES = 3;

// Show at most one feedback prompt per app session to stay unobtrusive
let promptedThisSession = false;

const kvArgs = (feature: FeedbackFeature) => ({
  namespace: "global",
  key: ["feature-feedback", feature],
});

function getFeatureFeedbackState(feature: FeedbackFeature): FeatureFeedbackState {
  return getKeyValue<FeatureFeedbackState>({
    ...kvArgs(feature),
    fallback: { uses: 0, done: false },
  });
}

function patchFeatureFeedbackState(feature: FeedbackFeature, patch: Partial<FeatureFeedbackState>) {
  const value = { ...getFeatureFeedbackState(feature), ...patch };
  setKeyValue({ ...kvArgs(feature), value }).catch(console.error);
}

// Record a successful use of a feature, and prompt for feedback on the Nth use.
// Nothing is ever sent to the server from here; showing the toast is local-only
// and a submission only happens when the user clicks Send in it.
export function trackFeatureUsage(feature: FeedbackFeature) {
  if (jotaiStore.get(settingsAtom).hideFeedbackPrompts) return;

  const state = getFeatureFeedbackState(feature);
  if (state.done) return;

  const uses = state.uses + 1;
  const shouldPrompt = uses >= PROMPT_AFTER_USES && !promptedThisSession;

  // Mark done when prompting so the toast can only ever appear once, even if
  // the app quits before the user interacts with it
  patchFeatureFeedbackState(feature, { uses, done: shouldPrompt });
  if (!shouldPrompt) return;

  promptedThisSession = true;
  showToast({
    id: `feature-feedback-${feature}`,
    timeout: null,
    dynamicHeight: true,
    hideDismiss: true,
    message: <FeedbackToast feature={feature} />,
  });
}
