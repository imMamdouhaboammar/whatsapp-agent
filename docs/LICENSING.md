# Licensing and Extensions

This document explains the intended licensing boundaries of WhatsApp Agent. The [LICENSE](../LICENSE) text controls the licensing of MPL-covered code.

## Free, self-hosted core

Project-authored application source code in this repository is available under the **Mozilla Public License, version 2.0 (MPL-2.0)**, unless a file clearly states a different license.

The core can be used, hosted, modified, and distributed commercially. When someone distributes modified files containing MPL-covered code, they must comply with the MPL-2.0 requirements for those files, including source availability and notices. Merely running a modified server privately, including making it available as an online service without distributing the server code, does not by itself trigger the MPL source-distribution obligation.

## Optional extensions, plugins, and skills

The commercial plan is to keep the functional core free and offer optional add-ons separately. Some add-ons may be free; others may be proprietary or sold under separate commercial terms.

An add-on written as independent files and distributed as a separate package may use its own license, subject to applicable third-party licenses and the MPL-2.0 terms. **Placing MPL-covered code inside a paid package does not remove the MPL obligations for that code.**

Every distributed add-on should identify its license and permissions in its package metadata and ship the relevant license text. The future marketplace is not a condition for using the free core.

## Third-party software and branding

Dependencies and third-party assets keep their respective licensing terms. Check and preserve required third-party notices before publishing binary installers or redistributed packages.

MPL-2.0 does not authorize use of third-party trademarks, including WhatsApp and Meta, or imply affiliation with their owners. Names and logos of the application, if protected separately, require their own branding policy.

## Before the public release

- Confirm the repository's project-authored code may be licensed under MPL-2.0, including any contributions from other authors
- Audit third-party code and asset licenses and provide required notices
- Attach the MPL-2.0 Exhibit A notice to source files, or place it in another location that clearly accompanies those files, especially when files may be distributed independently
- Keep commercial add-on packages and their license terms clearly separated from the free core

Official reference: [Mozilla's MPL-2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
