import { settingsAtom } from "@yaakapp-internal/models";
import { FeedbackToast } from "../components/FeedbackToast";
import { appInfo } from "./appInfo";
import type { FeedbackFeature } from "./featureFeedbackConstants";
import { dialogsAtom } from "./dialog";
import { jotaiStore } from "./jotai";
import { getKeyValue, setKeyValue } from "./keyValueStore";
import { showToast } from "./toast";

interface FeatureFeedbackState {
  uses: number;
  done: boolean;
}

const FEEDBACK_PROMPT_DELAY_MS = 1500;
const FEEDBACK_PROMPT_TIMEOUT_MS = 8000;

// Ask once the user has used a feature enough times to have formed an opinion
const PROMPT_AFTER_USES = 3;

// Show at most one feedback prompt per app session to stay unobtrusive
let promptedThisSession = false;

const lastTrackedAt: Partial<Record<FeedbackFeature, number>> = {};
const FEATURE_USE_DEBOUNCE_MS = 10_000;

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

function markFeatureFeedbackDone(feature: FeedbackFeature) {
  patchFeatureFeedbackState(feature, { done: true });
}

function showFeedbackToast(feature: FeedbackFeature) {
  if (!jotaiStore.get(settingsAtom).promptFeedback) return;

  showToast({
    id: `feature-feedback-${feature}`,
    timeout: FEEDBACK_PROMPT_TIMEOUT_MS,
    dynamicHeight: true,
    hideDismiss: true,
    message: (
      <FeedbackToast feature={feature} onDone={() => markFeatureFeedbackDone(feature)} />
    ),
  });
}

function showFeedbackToastWhenReady(feature: FeedbackFeature) {
  setTimeout(() => {
    if (!jotaiStore.get(settingsAtom).promptFeedback) return;

    if (jotaiStore.get(dialogsAtom).length === 0) {
      showFeedbackToast(feature);
      return;
    }

    const unsubscribe = jotaiStore.sub(dialogsAtom, () => {
      if (jotaiStore.get(dialogsAtom).length > 0) return;

      unsubscribe();
      showFeedbackToast(feature);
    });
  }, FEEDBACK_PROMPT_DELAY_MS);
}

// Record a successful use of a feature, and prompt for feedback on the Nth use.
// Nothing is ever sent to the server from here; showing the toast is local-only
// and a submission only happens when the user clicks Send in it.
export function trackFeatureUsage(feature: FeedbackFeature) {
  if (appInfo.featureLicense !== true || !jotaiStore.get(settingsAtom).promptFeedback) return;

  const now = Date.now();
  if (lastTrackedAt[feature] != null && now - lastTrackedAt[feature] < FEATURE_USE_DEBOUNCE_MS) {
    return;
  }
  lastTrackedAt[feature] = now;

  const state = getFeatureFeedbackState(feature);
  if (state.done) return;

  const uses = state.uses + 1;
  const shouldPrompt = uses >= PROMPT_AFTER_USES && !promptedThisSession;

  patchFeatureFeedbackState(feature, { uses });
  if (!shouldPrompt) return;

  promptedThisSession = true;
  showFeedbackToastWhenReady(feature);
}
