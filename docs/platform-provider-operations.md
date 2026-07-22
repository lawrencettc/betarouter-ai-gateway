# Platform provider operations

BetaRouter administrators can manage shared upstream credentials at
`https://admin.betarouter.com/platform-providers`. These credentials serve
credits-mode traffic and hybrid-mode fallback traffic. Organization-owned keys
continue to take precedence in hybrid mode.

## Encryption configuration

Set all three variables on every API and gateway process:

```dotenv
PLATFORM_PROVIDER_ENCRYPTION_KEYS=v1:<base64-encoded-32-byte-key>
PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION=v1
PLATFORM_PROVIDER_FINGERPRINT_KEY=<independent-base64-encoded-32-byte-key>
```

Set `PLATFORM_ADMIN_USER_IDS` to the immutable database user ID for each
operator in `ADMIN_EMAILS`. Email allowlisting alone is intentionally
insufficient for credential-management access.

Generate each key independently with `openssl rand -base64 32`. Store these
values with the deployment secrets, never in Git. Losing an encryption key
makes credentials written with that version unrecoverable.

To rotate encryption, add a new key to the comma-separated key ring (for
example `v1:<old>,v2:<new>`) and change the current version to `v2`. Keep the
old key until every credential has been replaced or re-encrypted. The
fingerprint key is separate and should not normally be rotated.

## Admin workflow

1. Open **Admin → Platform Providers** and select **Add provider**.
2. Choose the upstream provider, enter the API key, and optionally configure a
   base URL or provider-specific JSON options.
3. BetaRouter validates the key with the upstream before encrypting and saving
   it. Active database credentials take precedence over legacy environment
   variables for the same provider.
4. Use **Validate** to check a saved credential, the status switch to remove it
   from routing, and **Edit** to replace the key or connection settings.
5. **Reveal** requires a login less than 15 minutes old, confirmation, is
   rate-limited and audited, and clears the plaintext from the dashboard after
   60 seconds. If prompted, sign out and sign back in before revealing.

The database stores AES-256-GCM ciphertext, a masked display value, and a keyed
fingerprint used only for duplicate detection. Plaintext keys are never placed
in Redis or returned by list endpoints.

## Deployment

The production compose file requires the three encryption variables. Its
`RUN_MIGRATIONS=true` setting creates the credential and platform audit tables
when the new image starts. Deploy the image and migration before using the
dashboard; older application versions do not know how to read these rows.

Environment provider keys remain an operational fallback when a provider has
no active database credential. Once the dashboard credential has been
validated in production, the corresponding legacy environment key can be
removed during a later controlled deploy.
