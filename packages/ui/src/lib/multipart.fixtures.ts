// Multipart bodies for the parser and viewer tests

/** Gmail's batch response, as captured: a blank line, then one `application/http` part */
export const GMAIL_BATCH_BOUNDARY = "batch_8Js-Xj0pJXhmxHz6uTLe9MxOxKn8BPHl";
export const GMAIL_BATCH_CONTENT_TYPE = `multipart/mixed; boundary=${GMAIL_BATCH_BOUNDARY}`;
export const GMAIL_BATCH_JSON = [
  "{",
  '  "id": "IMPORTANT",',
  '  "name": "IMPORTANT",',
  '  "messageListVisibility": "hide",',
  '  "labelListVisibility": "labelShow",',
  '  "type": "system",',
  '  "messagesTotal": 23545,',
  '  "messagesUnread": 12,',
  '  "threadsTotal": 19203,',
  '  "threadsUnread": 10',
  "}",
].join("\n");
export const GMAIL_BATCH_BODY = [
  "",
  `--${GMAIL_BATCH_BOUNDARY}`,
  "Content-Type: application/http",
  "Content-ID: response-gtlr_43499",
  "",
  "HTTP/1.1 200 OK",
  "Content-Type: application/json; charset=UTF-8",
  "Vary: Origin",
  "Vary: X-Origin",
  "Vary: Referer",
  "",
  GMAIL_BATCH_JSON,
  `--${GMAIL_BATCH_BOUNDARY}--`,
  "",
].join("\r\n");
