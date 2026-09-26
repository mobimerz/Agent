Test-only certificates for `worker/test/ssl.test.ts` (never used outside tests).
Chain: `ca.crt` (root) → `int.crt` (intermediate) → `leaf.crt` (siteguard.test + www.siteguard.test) / `other.crt` (other.test).
`self.crt` is self-signed. All valid for 100 years. Regenerate with openssl if ever needed (see git history of this folder).
