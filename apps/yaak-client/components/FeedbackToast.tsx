import { HStack, VStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import type { FeedbackFeature } from "../lib/featureFeedback";
import { FEEDBACK_FEATURES } from "../lib/featureFeedback";
import { invokeCmd } from "../lib/tauri";
import { hideToastById, showToast } from "../lib/toast";
import { Button } from "./core/Button";
import { Input } from "./core/Input";

interface Props {
  feature: FeedbackFeature;
}

export function FeedbackToast({ feature }: Props) {
  const [text, setText] = useState<string>("");

  const handleDismiss = () => {
    hideToastById(`feature-feedback-${feature}`);
  };

  const handleSend = () => {
    // Fire-and-forget; failures are intentionally ignored
    invokeCmd("cmd_send_feedback", { feature, text: text.trim() }).catch(() => {});
    showToast({
      id: `feature-feedback-${feature}`,
      timeout: 3000,
      color: "success",
      message: "Thanks for the feedback!",
    });
  };

  return (
    <VStack space={2}>
      <p className="text-sm font-semibold">{FEEDBACK_FEATURES[feature]}</p>
      <div className="h-20">
        <Input
          size="xs"
          // The editor forces its mono font on the scroller, so the override
          // has to target it directly
          className="[&_.cm-scroller]:font-sans! [&_.cm-scroller]:text-sm!"
          label="Feedback"
          hideLabel
          stateKey={null}
          multiLine
          fullHeight
          placeholder="Your thoughts..."
          onChange={setText}
        />
      </div>
      <HStack space={1.5} justifyContent="end">
        <Button size="xs" color="secondary" variant="border" onClick={handleDismiss}>
          Dismiss
        </Button>
        <Button
          size="xs"
          color="primary"
          disabled={text.trim().length === 0}
          onClick={handleSend}
        >
          Send
        </Button>
      </HStack>
    </VStack>
  );
}
