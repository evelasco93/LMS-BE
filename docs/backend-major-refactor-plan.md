# Backend Major Refactor Plan

## Scope

This plan covers all backend handlers and shared backend modules:

- handlers/affiliates
- handlers/audit
- handlers/auth
- handlers/campaigns
- handlers/cherry-pick
- handlers/clients
- handlers/leads
- handlers/qa
- handlers/tenant-config
- handlers/users
- shared

## Current Gaps Identified

1. Campaign domain has oversized service/controller units that violate SRP and block safe changes.
2. Error and HTTP status behavior is inconsistent across handlers.
3. Leads orchestration includes synchronous Lambda fan-out with fail-open behavior in critical QA paths.
4. Cross-handler type imports create tight coupling and high change blast radius.
5. Scan-heavy DynamoDB access patterns exist on operational paths.
6. Test coverage is uneven; several handlers have no Vitest suites.
7. AuthN/AuthZ and request audit parsing are duplicated and inconsistent.

## Target Architecture

1. Thin delivery adapters per handler.
2. Application use-case layer per bounded context.
3. Domain policy/model layer per bounded context.
4. Infrastructure adapters (DynamoDB, Lambda invoke, S3, external APIs) isolated behind interfaces.
5. Shared cross-cutting modules for:
   - Response/error mapping

- Auth policy and claims extraction
- Correlation-id logging
- Validation

6. Dependency flow:
   - Controller -> Use case -> Domain policy -> Repository/Adapter
   - No direct cross-context imports between handler domains.

## Refactor Phases

### Phase 0 - Safety Net

Deliverables:

- Baseline API behavior tests for hotspot endpoints.
- Baseline latency and error metrics capture.
- Canonical response and error contract definition.

Exit criteria:

- Golden-path API assertions exist for key routes in campaigns, leads, tenant-config, users.

### Phase 1 - Cross-Cutting Standardization

Deliverables:

- Shared response envelope and error mapper in shared/services.
- Standard controller error-to-status mapping utility.
- Correlation-id logger propagation from each handler main.ts.
- Shared auth policy helpers for role and scope checks.

Exit criteria:

- All controllers use one status mapping mechanism.
- Correlation-id appears in all structured logs.

### Phase 2 - Campaign Decomposition

Deliverables:

- Split campaign.service.ts into focused units:
  - CampaignCrudUseCase
  - DeliveryConfigUseCase
  - CriteriaRuleUseCase
  - LogicRuleUseCase
  - CriteriaCatalogUseCase
  - LogicCatalogUseCase
  - ContractUseCase
  - CampaignValidationPolicy
  - CampaignRepository
- Split campaign.controller.ts by route domains while preserving public routes.

Exit criteria:

- No single campaign service file over 600 lines.
- Route behavior unchanged.

### Phase 3 - Tenant Config Decomposition

Deliverables:

- Split tenant-config.service.ts into:
  - CredentialUseCase
  - SchemaUseCase
  - PluginSettingUseCase
  - PlatformPresetUseCase
  - TagDefinitionUseCase
  - TenantConfigAuditPublisher
  - TenantConfigRepository
- Isolate encryption/decryption concerns behind one adapter.

Exit criteria:

- Credential/schema/plugin flows independently testable.

### Phase 4 - Leads and QA Hardening

Deliverables:

- Split leads.service.ts into:
  - LeadIntakeOrchestrator
  - LeadValidationUseCase
  - QaGateway
  - LeadPersistenceUseCase
  - LeadOutcomeUseCase
  - LeadQueryUseCase
- Split lead-delivery.service.ts into:
  - DeliveryTargetResolver
  - DeliveryExecutor
  - TrustedFormClaimUseCase
  - SoldPixelUseCase
  - DeliveryRetryPolicy
- Define explicit fail-open vs fail-closed matrix and make behavior configurable per campaign.

Exit criteria:

- End-to-end lead intake behavior is deterministic under downstream failures.

### Phase 5 - Remaining Handler Cleanup

Deliverables:

- Standardize auth/users/audit/cherry-pick handlers on common controller/use-case pattern.
- Remove cross-handler domain imports in favor of shared contracts.
- Consolidate bootstrap duplication in app.ts/main.ts through shared factory helpers.

Exit criteria:

- All handlers use the same structural template and error contract.

### Phase 6 - Performance and Compliance Closure

Deliverables:

- Replace scan/scanAll hotspots with query-first repository methods and indexes.
- Validate p95/p99 latency improvements for campaigns and leads routes.
- Enforce coverage gates and required test suites in CI.

Exit criteria:

- No scan-based operational reads in hot paths.
- Coverage thresholds met across all handler packages.

## Vitest Coverage Blueprint (All Handlers)

Global targets:

- Use-case layer: 90% statements, 85% branches.
- Controller layer: 80% statements minimum.
- Critical workflows: scenario coverage for success, validation failure, dependency failure, and retry behavior.

Required suites by handler:

- affiliates: CRUD success/failure, pagination/filter mapping, status mapping.
- audit: query parameter validation, time range behavior, export paths.
- auth: login/refresh success/failure, token edge cases.
- campaigns: route-group matrix, catalog versioning, conflict validation.
- cherry-pick: eligibility paths, idempotency, dependency failure modes.
- clients: CRUD matrix, filtering, status mapping.
- leads: intake orchestration, QA matrix, delivery retries, idempotency.
- qa/orchestrator: stage ordering, short-circuit logic, timeout behavior.
- qa/modules/criteria-validation: rule evaluation success/failure cases.
- qa/modules/duplicate-check: matching thresholds, duplicate detection variants.
- qa/modules/ipqs: credential resolution and score threshold behavior.
- qa/modules/logic-rules: rule tree evaluation and precedence behavior.
- qa/modules/trusted-form: cert validation/claim success/failure.
- tenant-config: credential/schema/plugin validation and encryption boundaries.
- users: authz matrix, admin-only operations, user lifecycle flows.

Shared test utilities:

- handler-level request factory helpers.
- shared mock factories for DynamoDB and Lambda invoke.
- deterministic clock/id helpers.
- standardized error assertion helpers.

## Implementation Order (First 10 Work Items)

1. Standardize response/error mapping in tenant-config and affiliates controllers.
2. Add correlation-id logging utility and wire through all handler main.ts files.
3. Extract Campaign criteria catalog use-case and tests.
4. Extract Campaign logic catalog use-case and tests.
5. Extract Tenant credential lifecycle use-case and tests.
6. Extract Tenant schema/preset/tag use-cases and tests.
7. Extract Leads intake orchestrator and QA gateway boundaries.
8. Harden shared Lambda invoke utility with timeout/retry/error shape policy.
9. Remove cross-handler imports by introducing shared contracts.
10. Align package versions and build/test orchestration across handler packages.

## Risk and Rollback

Risk controls:

- Route-by-route migration behind internal feature flags.
- Preserve existing API contracts while internals change.
- Canary release by handler domain.

Rollback:

- Keep legacy adapters callable during each phase.
- Toggle feature flags per route to revert quickly.
- Avoid schema-breaking storage changes until all read paths are dual-validated.
