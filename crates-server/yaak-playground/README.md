# yaak-playground

The API behind [yaak.run](https://yaak.run), for trying Yaak without bringing your own.

- Users and todos are fixed sample data.
- Posts can be created, changed, and deleted. Each client IP gets its own copy, which goes back
  to the sample data `YAAK_PLAYGROUND_RESET_AFTER_SECS` after its first write.
- `POST /auth/token` returns a bearer token for `GET /auth/me`. `POST /auth/session` sets a
  session cookie for `GET /auth/session`. Any username with the password `yaak` logs in.
- `GET /` lists every endpoint and `GET /openapi.json` describes them.

Nothing is written to disk, so a restart resets everything.

```sh
cargo run -p yaak-playground   # http://127.0.0.1:9228
```

Run `yaak-playground --help` for the limits. Behind a load balancer that sets
`X-Forwarded-For`, set `YAAK_PLAYGROUND_TRUST_FORWARDED_FOR=true`.

The image is `Dockerfile.playground` at the repo root.
