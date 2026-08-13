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
projection freshness presentation, offboarding workflow views, and the confirmation
contract for irreversible operations.

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

| Repository | Role |
| :-- | :-- |
| `identity-kernel` | Hosted login and step-up |
| `identity-control` | Identity Control Service |
| `organization-control` | Organization Control API — this application's backend |
| `foundation-platform` | Shared Go substrate, not consumed here |
| `identity-experience` | **Normative BFF pattern for this repository** |
| **`organization-experience`** | **This repository** |

## Layout

| Path | Contents |
| :-- | :-- |
| `apps/admin/` | Organization, Tenant, Workspace, Membership administration |
| `bff/` | Session and API proxy, conforming to the identity pattern |
| `docs/designs/` | Technical Design Documents |

## Designs

| TDD | Subject | Status |
| :-- | :-- | :-- |
| `TDD-organization-experience-001` | Administrative scope, provider mode, and safe bulk operations | approved |

## Standalone operation

This repository requires no Scnehaux platform other than the five it shares this
foundation with. Its one build-time dependency is `scnehaux-ui-platform`, which
produces no runtime edge, and it has no dependency on Notification, Audit, Software
Catalog, or Subscription & Entitlement.
