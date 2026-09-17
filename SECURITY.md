# Security Policy

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, private endpoints, customer data, or exploit details in a public issue.

Use **Security > Report a vulnerability** when GitHub private vulnerability reporting is enabled. Otherwise, contact
the repository owner, `@Liming201909016`, through an established private channel. If no private channel is known, a
contact-only issue may request one; include no affected component, vulnerability details, credentials or customer data.
Wait for a private route before sending the report. In the private report, include:

- the affected component and revision;
- reproduction steps with secrets and personal data removed;
- the expected and observed security boundary;
- the potential impact;
- any tested mitigation.

Do not test against production systems or access data that you are not authorized to use. Use synthetic data and the explicitly approved development environment.

## Supported versions

ESP is an internal hackathon prototype. Only the current `main` branch is evaluated for security fixes; no long-term support window is promised.

## Handling expectations

The maintainer will acknowledge a report, assess severity and scope, and coordinate validation before disclosure. Response times are best effort and are not a service-level agreement.
