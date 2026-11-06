import type {
  DecodedGrpcMessage,
  FlowMessage,
  GetMessagePayloadResponse,
  ListMessagesResponse,
} from "@yaakapp-internal/proxy-lib";
import { createContext, useContext, useEffect, useState } from "react";
import { mergeMessages } from "../lib/messages";
import { listen, rpc } from "../lib/rpc";

/** Where a flow's messages come from: the engine, or fixtures in the harness */
export interface MessageSource {
  list: (
    flowId: string,
    afterSeq: number | undefined,
    limit: number,
  ) => Promise<ListMessagesResponse>;
  /** Calls back with each message as it is written. Returns an unsubscribe function */
  subscribe: (callback: (message: FlowMessage) => void) => () => void;
  payload: (flowId: string, seq: number) => Promise<GetMessagePayloadResponse>;
  decodeGrpc: (flowId: string, seq: number, schemaless: boolean) => Promise<DecodedGrpcMessage>;
}

export const engineMessageSource: MessageSource = {
  list: (flowId, afterSeq, limit) => rpc("list_messages", { flowId, afterSeq, limit }),
  subscribe: (callback) => listen("message_write", ({ message }) => callback(message)),
  payload: (flowId, seq) => rpc("get_message_payload", { flowId, seq }),
  decodeGrpc: (flowId, seq, schemaless) => rpc("decode_grpc_message", { flowId, seq, schemaless }),
};

/** Where the Messages tab reads from: the engine, unless the harness provides fixtures */
export const MessageSourceContext = createContext<MessageSource>(engineMessageSource);

export function useMessageSource(): MessageSource {
  return useContext(MessageSourceContext);
}

/** Messages read in one call at most, while catching up */
const PAGE = 500;

interface State {
  flowId: string;
  messages: FlowMessage[];
  loading: boolean;
  error: string | null;
}

/**
 * A flow's messages, kept up to date while it streams: read in pages after the last one held,
 * and added as each is written. A message that does not follow on from the last one held (one
 * written while a page loaded) reads the pages after it instead.
 */
export function useFlowMessages(flowId: string, source: MessageSource) {
  const [state, setState] = useState<State>({
    flowId,
    messages: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let messages: FlowMessage[] = [];
    let reading = false;
    let readAgain = false;
    let frame: number | null = null;

    const publish = (loading: boolean, error: string | null = null) => {
      if (cancelled) return;
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      setState({ flowId, messages, loading, error });
    };
    // A chatty stream is drawn at most once a frame
    const publishSoon = () => {
      if (frame != null || cancelled) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!cancelled) setState({ flowId, messages, loading: false, error: null });
      });
    };

    const readAfter = async () => {
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      try {
        for (;;) {
          readAgain = false;
          const last = messages[messages.length - 1];
          const page = await source.list(flowId, last?.seq, PAGE);
          if (cancelled) return;
          messages = mergeMessages(messages, page.messages);
          // Shown as each page lands, so a stream that never pauses still shows what's read
          if (page.messages.length < PAGE && !readAgain) break;
          publishSoon();
        }
        publish(false);
      } catch (e) {
        publish(false, String(e));
      } finally {
        reading = false;
      }
    };

    setState({ flowId, messages: [], loading: true, error: null });
    void readAfter();
    const unsubscribe = source.subscribe((message) => {
      if (message.flowId !== flowId) return;
      const last = messages[messages.length - 1];
      const next = last == null ? 0 : last.seq + 1;
      if (!reading && message.seq === next) {
        messages = [...messages, message];
        publishSoon();
      } else if (last == null || message.seq > last.seq) {
        void readAfter();
      }
    });
    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [flowId, source]);

  // Another flow's, until the effect has started over for this one
  return state.flowId === flowId ? state : { flowId, messages: [], loading: true, error: null };
}
