# Digest Authentication

An HTTP Digest Authentication plugin that implements
[RFC 7616](https://datatracker.ietf.org/doc/html/rfc7616), with fallback to the
older [RFC 2617](https://datatracker.ietf.org/doc/html/rfc2617) and
[RFC 2069](https://datatracker.ietf.org/doc/html/rfc2069) behaviour that many
servers still speak.

## Overview

Digest Authentication proves you know a password without ever putting it on the
wire. The server issues a one-time `nonce`, and the client answers with a hash
over the credentials, the nonce and the request itself.

## How it works

Because the digest is computed over a server-issued nonce, the challenge has to
be fetched before the real request can be signed. On each send, the plugin:

1. Sends an unauthenticated probe of the same method and URL, carrying no
   headers of its own so it cannot authorize anything
2. Reads the `WWW-Authenticate: Digest …` challenge from the `401` response
3. Computes the response hash and returns the `Authorization` header

## Configuration

- **Username**: Username or user identifier
- **Password**: Password or authentication token
- **Realm** (advanced): Only needed when the server offers more than one realm.
  Leave it empty and the first challenge the server prefers is used.

## Supported challenges

| Feature    | Supported                                                     |
| ---------- | ------------------------------------------------------------- |
| Algorithm  | `MD5`, `MD5-sess`, `SHA-256`, `SHA-256-sess`                  |
| `qop`      | `auth`, `auth-int`, and challenges that omit `qop` (RFC 2069) |
| `opaque`   | Echoed back when the server sends one                         |
| `userhash` | Declined with `userhash=false`                                |

`auth-int` is used when the server offers it and Yaak has the request body in
hand. Bodies that are streamed from disk or above the size Yaak passes to auth
plugins aren't available to hash, so those requests use `auth` instead.

Credentials are normalized to Unicode NFC before hashing, per RFC 7616 §4.
Usernames outside ASCII are sent as an RFC 5987 extended value (`username*`).

## Troubleshooting

- **Server did not offer Digest authentication**: The endpoint answered the probe
  with a different scheme, or with no `WWW-Authenticate` header at all. Check the
  URL, and whether the endpoint requires auth in the first place.
- **Unsupported Digest algorithm**: The server asked for an algorithm this plugin
  doesn't implement, such as `SHA-512-256`.
- **401 Unauthorized**: Verify the username and password. If the server offers
  several realms, set the Realm field to the one your account belongs to.
