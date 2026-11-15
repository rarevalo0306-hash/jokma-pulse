# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

The current web product uses Node.js, Express, vanilla JavaScript, HTML, and CSS. It includes an installable PWA shell and adaptive phone/tablet/desktop layouts. A native iOS/Android wrapper must wait for a permanent backend URL because the active database is local-only.

## Users

The primary user is an operator or team member who monitors customer conversations, reviews generated replies, and responds across channels. User, organization, and company are distinct levels. One user may belong to multiple organizations, each organization may contain multiple users and multiple companies, and company access remains scoped by membership. Pulse needs explicit active-organization and active-company selectors. Changing either selection changes the working scope.

Business owners and administrators maintain the company profile, response guidance, users, permissions, and channel connections. Integration settings belong to an advanced administrator or integrator role.

## Product Purpose

Jokma Pulse is a multi-company omnichannel inbox. It brings a person's messages and reviews from multiple channels into one conversation, uses the selected company's profile to prepare a reply, and supports human review before delivery.

Success means an operator can move from a new notification to an approved response quickly while always knowing the active company, channel, draft state, and delivery result.

## Positioning

Pulse combines a company-specific knowledge profile with a person-first conversation that spans channels. Connections are direct to each platform and do not depend on n8n. Email is received through IMAP and sent through SMTP.

## Operating Context

Operators work from desktop web during sustained support sessions and from iOS or Android for notification-driven triage. They switch companies, filter an inbox, open a person, review channel context, edit an AI-assisted draft, approve it, send it, and confirm delivery.

Administrators manage company profiles, users, roles, response guidance, and channel connections separately from the daily inbox.

## Capabilities and Constraints

- Each company has its own profile, accounts, messages, connections, users, and permissions.
- Registration creates the user account first, then an organization, then its first company. The account must never be structurally tied to one organization or company.
- A user with multiple memberships needs persistent active-organization and active-company selectors.
- Facebook and Instagram use direct Meta connections for inbound webhooks and approved outbound messages. Instagram OAuth completion still depends on Meta's whitelist configuration.
- Direct email, X DM, and Google Reviews clients are implemented; real-provider validation remains pending until credentials and provider access are supplied.
- Conversation status, self-assignment, internal notes, and audit events are available for operational follow-up.
- The response workflow must distinguish Draft, In review, Approved, Sending, Sent, Delivered, and Error.
- Human editing and approval happen before a generated reply is sent.
- The system must not expose secrets in the interface, logs, or generated artifacts.
- Production storage, authentication, and synchronization must support concurrent web and mobile clients.
- No Meta App Review, advanced access, or business verification work is part of the current scope.

## Brand Commitments

Preserve the Jokma Pulse name, the existing Jokma logo, the pulse mark, and the mint accent associated with the brand. The product voice is direct, calm, and clear in Spanish.

## Evidence on Hand

- Existing source and tests in this repository.
- Production web app at `https://pulse.jokma.app`.
- Existing light and dark themes, legal pages, company profiles, inbox data, response generation, Facebook OAuth, and Instagram OAuth and webhook code.
- Test companies Cafetería Lumen and Clínica Dental Arce provide representative content. They are demonstration data rather than customer proof.

## Product Principles

- Keep the active company and channel context visible at every operational step.
- Treat generated text as an editable draft until a human approves it.
- Show delivery truth explicitly and preserve recoverable history.
- Keep operator work separate from business administration and integration plumbing.
- Adapt navigation and controls to web, iOS, and Android conventions while preserving one product identity.

## Accessibility & Inclusion

The web experience should meet WCAG 2.2 AA. Native apps should support Dynamic Type or system font scaling, dark mode, reduced motion, screen readers, keyboard navigation where applicable, and platform-standard touch targets.
