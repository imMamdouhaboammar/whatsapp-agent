# Security Policy

Security is a priority for WhatsApp Agent because the application handles private conversations, messaging credentials, customer information, and AI-driven actions

We welcome responsible security research and encourage researchers to report vulnerabilities privately so they can be investigated and addressed before public disclosure

## Supported Versions

WhatsApp Agent is currently under active development and has not published a stable release

| Version | Security Support |
| --- | --- |
| `main` (latest commit) | ✅ Active development |
| Older commits and snapshots | ❌ Not maintained |
| Third-party forks | ❌ Not maintained by this project |

Security fixes are currently provided on a best-effort basis through the `main` branch

## Reporting a Vulnerability

**Please do not disclose security vulnerabilities through public GitHub Issues, Discussions, or Pull Requests**

To report a vulnerability:

1. Visit [GitHub Security Advisories](https://github.com/imMamdouhaboammar/whatsapp-agent/security/advisories)
2. Select **Report a vulnerability** if private vulnerability reporting is enabled
3. Submit your findings with enough information to reproduce and assess the issue

If private reporting is unavailable, you may open a public issue requesting a secure contact method, without including vulnerability details, exploit instructions, or sensitive information

### What to Include

A useful security report should contain:

- A clear description of the vulnerability
- The affected component and commit or version
- Steps to reproduce the issue
- A minimal, sanitized proof of concept, if available
- The potential security impact
- Relevant logs or screenshots with personal data and secrets removed
- Suggested remediation, if applicable

Never include real WhatsApp authentication credentials, API keys, session files, or private customer conversations in a report

## Security Scope

We are particularly interested in vulnerabilities affecting:

### Authentication and Authorization

- Dashboard authentication and session handling
- Unauthorized access to REST APIs, Server-Sent Events, or MCP tools
- Privilege escalation and authentication bypass
- Cross-origin request and session security

### WhatsApp Account Security

- Unauthorized access to WhatsApp pairing credentials or sessions
- Account impersonation or session hijacking
- Unauthorized message sending or conversation access
- Disclosure of contacts, conversations, or account information

### AI Agent and Tool Security

- Prompt injection that causes unauthorized tool execution or messaging actions
- Unauthorized access to MCP tools or connected services
- Bypassing application-enforced action permissions
- Cross-conversation or cross-business data exposure
- Sensitive information leakage through AI responses or tool outputs

### Data Privacy and Infrastructure

- Exposure of API keys, tokens, or environment variables
- Unauthorized access to stored conversations, customer profiles, or business knowledge
- Sensitive data leakage through logs, diagnostics, or backups
- Insecure file or media processing
- Vulnerabilities affecting database access, migrations, or data isolation

AI response quality problems without a demonstrated security impact should generally be reported through regular GitHub Issues

## Responsible Security Research

We ask security researchers to:

- Test only accounts and environments they own or are explicitly authorized to assess
- Use synthetic data whenever possible
- Avoid accessing, modifying, or deleting other people's information
- Avoid sending unsolicited messages to real WhatsApp users
- Refrain from denial-of-service attacks, spam, social engineering, or destructive testing
- Stop testing and report privately if unintended access to sensitive data occurs
- Give maintainers a reasonable opportunity to investigate and address confirmed vulnerabilities before public disclosure

Research conducted against third-party infrastructure, Meta services, or WhatsApp accounts without authorization is outside the scope of this project's security policy

## Disclosure and Response Process

Our intended response process is:

1. **Acknowledgment:** Aim to acknowledge reports within 5 business days
2. **Assessment:** Reproduce the issue and evaluate its impact and severity
3. **Remediation:** Develop a fix and add regression tests where appropriate
4. **Verification:** Validate the fix and review potential side effects
5. **Disclosure:** Coordinate publication of a security advisory when appropriate

These are target response times, not guaranteed service-level commitments

Reporters may be credited in the security advisory with their consent

## Secure Deployment Recommendations

WhatsApp Agent is designed primarily for self-hosted use

Operators should:

- Keep the dashboard bound to `127.0.0.1` unless remote access is required
- Configure a strong, randomly generated `AGENT_DASHBOARD_TOKEN` before exposing the dashboard beyond localhost
- Set `AGENT_CAPABILITIES_OWNER_TOKEN` to protect owner-level capability endpoints
- Use HTTPS and explicitly configure allowed origins for remote dashboard access
- Protect WhatsApp session credentials, local databases, backups, and environment files
- Never commit `.env` files, session data, access tokens, or customer information
- Restrict access to MCP integrations and connected tools
- Keep Bun and third-party dependencies updated
- Review permissions granted to AI agents and external integrations
- Verify backup, recovery, and data-deletion procedures before production deployment

Refer to the [README](README.md) and [MVP Launch Readiness](docs/MVP_LAUNCH_READINESS.md) for current deployment guidance and known limitations

**Important:** WhatsApp Agent uses Baileys, an unofficial WhatsApp Web integration. It is not an official Meta or WhatsApp Business API product. Operators are responsible for ensuring that their use complies with applicable platform rules and legal requirements

## Security Limitations

WhatsApp Agent is actively evolving

The existence of this security policy does not imply that every component has undergone an independent security audit or that the project is ready for unrestricted production deployment

Security-sensitive changes should be validated before connecting real business accounts or exposing services publicly

## Maintainer

**Mamdouh Aboammar**

GitHub: [@imMamdouhaboammar](https://github.com/imMamdouhaboammar)

Repository: [whatsapp-agent](https://github.com/imMamdouhaboammar/whatsapp-agent)

Thank you for helping keep WhatsApp Agent and its users safe
