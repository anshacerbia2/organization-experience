# Organization Experience

TypeScript application and backend-for-frontend for Organization, Tenant, Workspace,
Membership, and offboarding administration. It realizes **SAD-012 Scnehaux Organization
Experience** under **PAD-PLT-002 Organization & Tenancy Platform**.

## Conforms to the identity BFF pattern, without variation

The session pattern is not designed here. This application conforms in full to
`TDD-identity-experience-001`: an opaque `__Host-` session cookie, all tokens held
server-side, three independent cross-site request forgery defences, server-side
refresh, and idle plus absolute expiry.

A divergence in this repository is a defect, not a local decision. One pattern, two
applications.

## What this repository owns

The thing that differs: **administrative scope**. The Organization control plane
distinguishes two callers at the database level, with two PostgreSQL runtime roles and
two connection pools. This application carries that boundary into the interface,
because a boundary the operator cannot see is a boundary the operator will cross by
accident.

```text
Tenant scope                          Provider scope
├── one Tenant, from the operator's   ├── explicitly selected Tenants or all
│   administrative assignment         ├── requires step-up authentication
├── default on sign-in                ├── reason recorded before entry
└── no reason required                └── time-bounded, expires automatically
```

An operator never holds both at once, and the session records which scope was active
for every action taken.

Beyond scope, this repository owns bulk operation preview and per-item outcome,
projection freshness presentation, offboarding workflow views, the confirmation
contract for irreversible operations, and the page where an invited person accepts an
invitation, signed in as themselves (ADR-ORG-007).

## Two presentation rules that are security controls

**Revocation is shown as accepted, not enforced**, until the enforced timestamp
arrives. An interface that writes "revoked" the moment the API returns 202 teaches
operators that revocation is instant. Incident response then gets planned around a
property the system does not have, which is exactly how the previous implementation
failed.

**Staleness is rendered inline with the data**, not as a page-level notice. An operator
reading a Membership list needs to know that list is stale at the point of reading it.
Views feeding an irreversible operation never use a marker; they call the authoritative
fresh check.

## What it does not own

It makes no authorization decision. Every command is reauthorized by the Organization
Control API, per SAD-012 §8 and STD-IAM-001 §3.9. It holds no domain state, no token in
the browser, and no direct route to Keycloak or to any database.

## Governance lineage

```text
PAD-PLT-002                      Organization & Tenancy Platform
    ↓
SAD-012                          Scnehaux Organization Experience
    ↓
TDD-organization-experience-*    Technical designs   (docs/designs)
    ↓
Source code
```

## Repository map

| Repository                    | Role                                                  |
| :---------------------------- | :---------------------------------------------------- |
| `identity-kernel`             | Hosted login and step-up                              |
| `identity-control`            | Identity Control Service                              |
| `organization-control`        | Organization Control API — this application's backend |
| `foundation-platform`         | Shared Go substrate, not consumed here                |
| `identity-experience`         | **Normative BFF pattern for this repository**         |
| **`organization-experience`** | **This repository**                                   |

## Stack

The same as identity-experience's (SAD-012 1.1.0): a React 19 single-page application built with
Vite, behind a Fastify BFF on Node.js 24, in one pnpm workspace. ADR-GLB-FE-003 §5 sends an
internal B2B tool like this one to Vite rather than Next.js, and ADR-GLB-FE-011 §5.2 permits it.

**The conformance is checked, not promised.** Every BFF file that carries the session pattern is
byte-identical to identity-experience's at one pinned commit. `bff/conformance.json` lists each of
them, and lists every file that differs with the reason it differs. `pnpm check:bff-conformance`
fetches the pinned files and fails on a single changed byte, and CI runs it on every change. A fix
to the pattern lands in identity-experience first, and reaches this repository by moving the pin.

**The stack is proven in a browser.** `.github/workflows/stack-proof.yml` brings up identity-kernel,
identity-control and organization-control, this BFF and identity-experience's, and drives Chromium
through the kernel's hosted login (STD-GLB-009 §Stack-Level Proofs, TDD-organization-experience-001
§End to End). It runs on every change, daily, and by hand with a `*_ref` input per producer, so a
producer's branch is proven here before it merges:

```sh
gh workflow run stack-proof.yml -R anshacerbia2/organization-experience -f identity_ref=<branch>
```

**It looks like identity-experience.** The console's tokens, foundations and components are copied
from identity-experience's `packages/ui` and its frame, at a pinned commit, under `apps/admin/src/ui/`
(TDD-organization-experience-001 §Visual Language). That local copy is an approved exception,
`ADR-ORG-008`, which expires on 2027-04-20; its exit is `apps/admin/src/ui/index.ts` re-exporting the
UI Platform's packages. `pnpm test:browser` runs every main route in
Chromium against the build, with fixtures, and keeps a screenshot of each; it needs `pnpm build` first.

**The API client is contract-tested.** The browser and the BFF call the Organization Control API
through hand-written clients. `ADR-GLB-010 §5.1` admits that only when they are "contract-tested in CI
against the published specification", so `contracts/` vendors organization-control's `api/openapi.yaml`
at a pinned commit, `pnpm check:api-contract` proves the copy byte for byte, and the contract tests hold
every request the application's tests send, every path its source writes, the BFF's own calls and the
browser fixtures against it (TDD-organization-experience-001 1.12.0 §API / Interface).

## Layout

| Path             | Contents                                                                                            |
| :--------------- | :-------------------------------------------------------------------------------------------------- |
| `apps/admin/`    | Organization, Tenant, Workspace, Membership administration                                          |
| `bff/`           | Session and API proxy, conforming to the identity pattern; `bff/conformance.json`                   |
| `scripts/`       | `check-bff-conformance.mjs`, `check-api-contract.mjs`, `new-client-key.mjs`, `dev-register-bff.ps1` |
| `contracts/`     | Organization Control's `openapi.yaml`, pinned, and the client's contract tests                      |
| `e2e/`           | The stack-level proof's journeys and its seed; `browser/`, the fixture-backed views                 |
| `deploy/dev/`    | How this BFF's client is registered on the development server                                       |
| `docs/designs/`  | Technical Design Documents                                                                          |
| `docs/runbooks/` | Provider-access review, bulk partial failure, stuck offboarding                                     |

## Designs

| TDD                               | Subject                                                                 | Status   |
| :-------------------------------- | :---------------------------------------------------------------------- | :------- |
| `TDD-organization-experience-001` | Administrative scope, provider mode, and safe bulk operations           | approved |
| `TDD-organization-experience-002` | Organization, Tenant, Workspace, and Membership administration surfaces | approved |
| `TDD-organization-experience-003` | Offboarding workflow and obligation tracking views                      | approved |

## Standalone operation

This repository requires no Scnehaux platform other than the five it shares this
foundation with. It has no dependency on Notification, Audit, Software Catalog, or
Subscription & Entitlement. `scnehaux-ui-platform` becomes its build-time design-system
dependency once UI Platform ships its primitives (SAD-012 1.1.0 §7.3); until then it uses its
own components, as identity-experience does, under the exception `ADR-ORG-008` (expires 2027-04-20).
