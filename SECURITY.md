# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **[security@mintlayer.org](mailto:security@mintlayer.org)** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- the commit or version you tested against,
- your assessment of severity.

We'll acknowledge receipt and keep you informed as we investigate. Please give us a reasonable
window to ship a fix before disclosing publicly.

### Encrypting your report

Please encrypt anything sensitive: a vulnerability report in plaintext email is itself a
disclosure.

| | |
|---|---|
| **Key** | <https://www.mintlayer.org/assets/keys/security.asc> |
| **Fingerprint** | `8EE2 B7AC 3BA2 5D1B 3C5A  BD49 0ED0 DD9A A56E BDA4` |
| **Identity** | Mintlayer Security \<security@mintlayer.org\> |
| **Type** | RSA 4096, valid 2026-06-01 → 2028-05-31 |

```bash
curl -sSL https://www.mintlayer.org/assets/keys/security.asc | gpg --import

# Confirm the fingerprint matches the table above before you trust it
gpg --fingerprint security@mintlayer.org
```

Fetching a key over HTTPS only proves it came from the site. If your report is high-impact,
verify the fingerprint through a second channel before relying on it.

## Supported versions

Mojito ME is **pre-production**. There is no released version and no supported branch yet; `main`
is the only line of development.

## Scope

This repository is a **UI implementation**. It has no backend, no chain connectivity and no key
management. Cryptography is deliberately mocked:

- the recovery phrase is a fixed demo constant, not generated entropy;
- import checksum validation is a stand-in, not BIP39;
- the BIP39 word list is truncated;
- the draw-your-own-entropy screen meters input but derives no key;
- biometric prompts are simulated.

These are documented in the README and are **not** vulnerabilities. Reports against them will be
closed as out of scope.

**In scope** meanwhile: anything where the UI makes a security claim it doesn't keep. For example,
a control that reports success on an action that didn't happen, secret material reachable through
the accessibility tree or a screenshot, or a state that locks a user out with no recovery path.
Those are real defects today, even without a backend.

## Bug bounty

**The Mintlayer bug bounty does not currently apply to this repository.**

It becomes valid when Mojito ME ships to production, at which point this file will be updated with
the scope, severity bands and reward terms. Until then reports are genuinely welcome and will be
credited, they are simply not eligible for a payout.
