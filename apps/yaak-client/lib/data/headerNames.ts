import type { GenericCompletionOption } from '@yaakapp-internal/plugins';

export const headerNames: (GenericCompletionOption | string)[] = [
  {
    type: 'constant',
    label: 'Content-Type',
    info: 'The original media type of the resource (prior to any content encoding applied for sending)',
  },
  {
    type: 'constant',
    label: 'Content-Length',
    info: 'The size of the message body, in bytes, sent to the recipient',
  },
  {
    type: 'constant',
    label: 'Accept',
    info:
      'The content types, expressed as MIME types, the client is able to understand. ' +
      'The server uses content negotiation to select one of the proposals and informs ' +
      'the client of the choice with the Content-Type response header. Browsers set required ' +
      'values for this header based on the context of the request. For example, a browser uses ' +
      'different values in a request when fetching a CSS stylesheet, image, video, or a script.',
  },
  {
    type: 'constant',
    label: 'Accept-Encoding',
    info:
      'The content encoding (usually a compression algorithm) that the client can understand. ' +
      'The server uses content negotiation to select one of the proposals and informs the client ' +
      'of that choice with the Content-Encoding response header.',
  },
  {
    type: 'constant',
    label: 'Accept-Language',
    info:
      'The natural language and locale that the client prefers. The server uses content ' +
      'negotiation to select one of the proposals and informs the client of the choice with ' +
      'the Content-Language response header.',
  },
  {
    type: 'constant',
    label: 'Authorization',
    info: 'Provide credentials that authenticate a user agent with a server, allowing access to a protected resource.',
  },
  'Cache-Control',
  'Cookie',
  'Connection',
  'Content-MD5',
  'Date',
  'Expect',
  'Forwarded',
  'From',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Range',
  'If-Unmodified-Since',
  'Max-Forwards',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'TE',
  'User-Agent',
  'Upgrade',
  'Via',
  'Warning',
];
