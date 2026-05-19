# Requirements: Quiqup MCP — Full Frontend API Coverage

**Defined:** 2026-05-19
**Core Value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
**Source of truth:** `docs/quiqup-api-full-frontend-extract.md`

## v1 Requirements

Requirements are grouped by service-host family. Each REQ-ID maps to one MCP tool (1:1 with an endpoint) unless noted. `[x]` = already shipped in `lib/tools/*.ts`. `[ ]` = to be built.

### Auth, Account, Permissions (AUTH)

- [x] **AUTH-01**: `whoami_platform` — `GET /me` (Platform) — diagnostic for actor-token (existing)
- [x] **AUTH-02**: `register` — `POST /partner/register` (Platform) (existing)
- [x] **AUTH-03**: `get_account` — `GET /account` (Platform)
- [x] **AUTH-04**: `get_permissions` — `GET /permissions` (Platform)
- [x] **AUTH-05**: `get_account_capabilities` — `GET /accounts/{id}/capabilities` (Platform)
- [x] **AUTH-06**: `get_account_by_id` — `GET /accounts/{id}` (Platform)
- [ ] **AUTH-07**: `update_account` — `PUT /accounts` (Platform) — also used by finance bank details
- [x] **AUTH-08**: `list_service_kinds` — `GET /quiqup/service-kinds` (Platform)
- [x] **AUTH-09**: `get_quiqdash_init` — `GET /quiqdash/init` (Platform) — bootstrap payload
- [ ] **AUTH-10**: `decide_feature_flags_bulk` — `POST /featureflags/decide-bulk` (Platform)
- [ ] **AUTH-11**: `get_return_settings` — `GET /api/accounts/{accountID}/return-settings` (Platform)
- [ ] **AUTH-12**: `update_return_settings` — `PUT /api/accounts/{accountID}/return-settings` (Platform)
- [ ] **AUTH-13**: `create_account_team_member` — `POST /account/team` (Platform)

### Addresses, Countries, Cities, Places (ADDR)

- [ ] **ADDR-01**: `list_account_addresses` — `GET /accounts/{id}/addresses` (Platform)
- [ ] **ADDR-02**: `create_partner_address` — `POST /partner/addresses` (Platform)
- [ ] **ADDR-03**: `update_partner_address` — `PATCH /partner/addresses/{id}` (Platform)
- [ ] **ADDR-04**: `list_countries` — `GET /countries` (Platform)
- [ ] **ADDR-05**: `list_country_states` — `GET /countries/{countryIso2}/states` (Platform)
- [ ] **ADDR-06**: `list_country_cities` — `GET /countries/{countryNameOrIso2}/cities` (Platform)
- [ ] **ADDR-07**: `list_state_cities` — `GET /countries/{countryIso2}/states/{stateNameOrCode}/cities` (Platform)
- [ ] **ADDR-08**: `lookup_google_place` — `GET {Google Places}/v1/places/{placeId}` — needs separate API key surface

### Integrations (INTG)

- [ ] **INTG-01**: `list_integration_connections` — `GET /integrations/connections` (Platform)
- [ ] **INTG-02**: `delete_integration_source` — `DELETE /{source}/delete/{shopName}` (Platform) — DESTRUCTIVE, requires `confirm: true`
- [ ] **INTG-03**: `list_integration_order_reasons` — `GET /integrations/order-reasons` (Platform)
- [ ] **INTG-04**: `repair_integration_orders` — `POST /integrations/repair-orders` (Platform)
- [ ] **INTG-05**: `get_integration_order` — `GET /order/{orderUUID}` (Platform)
- [ ] **INTG-06**: `confirm_ff_export` — `POST /orders/confirm-ff-export` (Platform)
- [x] **INTG-07**: `get_shopify_config` — `GET /shopify/config/{shopName}` (Platform)
- [x] **INTG-08**: `list_shopify_delivery_methods` — `GET /shopify/delivery-methods` (Platform)
- [x] **INTG-09**: `list_shopify_locations` — `GET /shopify/locations` (Platform)
- [x] **INTG-10**: `update_shopify_config` — `PUT /shopify/config` (Platform)
- [x] **INTG-11**: `update_shopify_connection` — `PUT /shopify/connection` (Platform)
- [x] **INTG-12**: `setup_shopify_callback` — `POST /shopify/callback` (Platform) — OAuth completion
- [ ] **INTG-13**: `list_woocommerce_connections` — `GET /woocommerce/connections` (Platform)
- [ ] **INTG-14**: `get_woocommerce_config` — `GET /woocommerce/config/{siteName}` (Platform)
- [ ] **INTG-15**: `list_woocommerce_states` — `GET /woocommerce/states` (Platform)
- [ ] **INTG-16**: `list_woocommerce_shipping_lines` — `GET /woocommerce/shipping-lines` (Platform)
- [ ] **INTG-17**: `setup_woocommerce_connection` — `POST /woocommerce/connection` (Platform)
- [ ] **INTG-18**: `upsert_woocommerce_config` — `PUT /woocommerce/settings/config/upsert` (Platform)
- [x] **INTG-19**: `list_quiqup_order_states` — `GET /quiqup/orders/states` (Platform)
- [x] **INTG-20**: `install_salla` — `GET /integrations/install/salla` (Platform) — returns OAuth URL
- [x] **INTG-21**: `get_salla_connection` — `GET /integrations/connections/{id}` (Platform)
- [ ] **INTG-22**: `delete_salla_connection` — `DELETE /integrations/connections/{id}` (Platform) — DESTRUCTIVE
- [x] **INTG-23**: `toggle_salla_fulfillment` — `PUT /integrations/connections/{id}/fulfillment` (Platform)
- [x] **INTG-24**: `get_salla_platform_data` — `GET /integrations/configs/{connectionId}/platform-data` (Platform)
- [x] **INTG-25**: `get_salla_config` — `GET /integrations/configs/{connectionId}` (Platform)
- [x] **INTG-26**: `update_salla_config` — `PUT /integrations/configs/{connectionId}` (Platform)

### Orders — Listing & Filters (ORDL)

- [x] **ORDL-01**: `recent_orders` — orders listing (existing; covers `ordersListingQuery` GraphQL)
- [ ] **ORDL-02**: `lookup_orders_ids` — `ordersListingIdsQuery` GraphQL (Orders Core GraphQL)
- [ ] **ORDL-03**: `bulk_orders_lookup` — `bulkOrdersLookupQuery` GraphQL (Orders Core GraphQL)
- [ ] **ORDL-04**: `find_order_by_id_or_barcode` — `GET /quiqdash/orders/find_by_id_or_barcode` (Platform)
- [ ] **ORDL-05**: `list_depots` — `GET /quiqdash/depots` (Platform)
- [ ] **ORDL-06**: `list_missions_filter` — `GET /quiqdash/missions` (Platform) — autocomplete form
- [ ] **ORDL-07**: `download_orders_export` — `GET /orders/download` (Ex-core) — CSV
- [ ] **ORDL-08**: `list_partner_cancellation_reasons` — `GET /orders/partner-cancellation-reasons` (Platform/Quiqup REST)
- [ ] **ORDL-09**: `list_on_hold_reasons` — `GET /quiqdash/orders/states/on_hold_reasons` (Platform)
- [ ] **ORDL-10**: `list_return_to_origin_reasons` — `GET /quiqdash/orders/states/return_to_origin_reasons` (Platform)
- [ ] **ORDL-11**: `list_cancellation_reasons` — `GET /quiqdash/orders/cancellation-reasons` (Platform)
- [ ] **ORDL-12**: `list_courier_failure_reasons` — `GET /quiqdash/courier/delivery_failure_reasons` (Platform)

### Orders — Single Order Details (ORDS)

- [x] **ORDS-01**: `get_lastmile_order` — order detail read (existing; covers `orderDetailsQuery` GraphQL surface)
- [ ] **ORDS-02**: `get_order_history` — `GET /orders/{id}/history` (Quiqup REST)
- [ ] **ORDS-03**: `export_order` — `PUT /orders/export/{id}` (Quiqup REST)
- [ ] **ORDS-04**: `update_fulfilment_order_status` — `PATCH /api/fulfilment/orders/{id}` (Platform)
- [ ] **ORDS-05**: `list_order_audit_events` — `GET {AUDIT_BASE_URL}/events?resourceID.eq={orderUuid}` (Audit) — new client
- [ ] **ORDS-06**: `create_order_charge` — `POST /quiqdash/order-charge` (Platform)
- [ ] **ORDS-07**: `update_order_weight` — `PATCH /quiqdash/orders/{orderId}/weight` (Platform)
- [ ] **ORDS-08**: `upload_order_document` — `POST /orders-by-client-id/{clientOrderID}/documents` (Orders Core REST) — multipart

### Orders — Creation (ORDC)

- [x] **ORDC-01**: `create_lastmile_order` — `POST /quiqdash/orders` (Platform) (existing, eval baseline)
- [x] **ORDC-02**: `update_lastmile_order` — order update (existing)
- [x] **ORDC-03**: `update_order_waypoint` — pickup/dropoff address edit (existing)
- [ ] **ORDC-04**: `create_internal_fulfilment_order` — `POST /internal/fulfilment/orders` (Platform)
- [ ] **ORDC-05**: `bulk_create_orders` — `POST /quiqdash/bulk_orders` (Platform) — multipart CSV

### Orders — Status Transitions (ORDT)

All `PUT /quiqdash/orders/batch/...` and friends. All DESTRUCTIVE → require `confirm: true` and `dry_run` flag.

- [x] **ORDT-01**: `mark_ready_for_collection` — `set_ready_for_collection` (existing)
- [x] **ORDT-02**: `cancel_lastmile_orders_batch` — `set_cancelled` (existing)
- [ ] **ORDT-03**: `set_collected` — `PUT /quiqdash/orders/batch/set_collected`
- [ ] **ORDT-04**: `set_received_at_depot` — `PUT /quiqdash/orders/batch/set_received_at_depot`
- [ ] **ORDT-05**: `set_at_depot` — `PUT /quiqdash/orders/batch/set_at_depot`
- [ ] **ORDT-06**: `set_in_transit` — `PUT /quiqdash/orders/batch/set_in_transit`
- [ ] **ORDT-07**: `set_scheduled` — `PUT /quiqdash/orders/batch/set_scheduled`
- [ ] **ORDT-08**: `set_delivery_complete` — `PUT /quiqdash/orders/batch/set_delivery_complete`
- [ ] **ORDT-09**: `set_on_hold` — `PUT /quiqdash/orders/batch/set_on_hold`
- [ ] **ORDT-10**: `set_return_to_origin` — `PUT /quiqdash/orders/batch/set_return_to_origin`
- [ ] **ORDT-11**: `set_returned_to_origin` — `PUT /quiqdash/orders/batch/set_returned_to_origin`
- [ ] **ORDT-12**: `set_delivery_failed` — `PUT /quiqdash/orders/batch/set_delivery_failed`
- [ ] **ORDT-13**: `set_collection_failed` — `PUT /quiqdash/courier/orders/set_collection_failed`
- [ ] **ORDT-14**: `unpool_order` — `PUT /quiqdash/missions/unpool/orders/{orderUUID}`

### Missions, Labels, Slips (MISS)

- [ ] **MISS-01**: `create_mission` — `POST /quiqdash/missions` (Platform)
- [ ] **MISS-02**: `transfer_mission_orders` — `PUT /quiqdash/missions/transfer/{missionID}` (Platform)
- [ ] **MISS-03**: `download_pending_labels` — `GET /pending_orders_labels` (Quiqup GraphQL host, PDF) — base64 response
- [x] **MISS-04**: `get_lastmile_order_label` — `GET /order_label/{order_ids}` (existing)
- [ ] **MISS-05**: `download_return_label` — `GET /return_order_label/{orderId}` (Quiqup GraphQL host, PDF)
- [ ] **MISS-06**: `download_slip` — `GET /slips/{slipType}` (Platform, PDF) — picking-list / packing-list

### Inbound — Warehouse Receiving (INBD)

- [x] **INBD-01**: `book_inbound_slot` — `POST /fulfillment/inbound/book` (existing)
- [x] **INBD-02**: `list_inbound_slots` — `GET /api/fulfilment/slots/available` (existing)
- [x] **INBD-03**: `list_inbounds` — `GET /api/fulfilment/inbounds` (existing)
- [x] **INBD-04**: `get_inbound` — `GET /api/fulfilment/inbound/{id}` (existing)
- [x] **INBD-05**: `get_inbound_state_history` — `GET /api/fulfilment/inbound/{id}/state-history` (existing)
- [x] **INBD-06**: `get_inbound_items` — inbound items read (existing)
- [ ] **INBD-07**: `get_account_facility` — `GET /accounts/{accountId}/facility` (Platform)
- [ ] **INBD-08**: `cancel_inbound` — `POST /api/fulfilment/inbounds/{id}/cancel` (Platform) — DESTRUCTIVE
- [ ] **INBD-09**: `edit_inbound` — `PATCH /fulfillment/inbounds/{id}` (Platform)

### Products (PROD)

- [x] **PROD-01**: `create_product` — `POST /api/fulfilment/products` (existing)
- [x] **PROD-02**: `update_product` — `PUT /fulfillment/products` (existing — upsert)
- [x] **PROD-03**: `get_product_by_sku` — `GET /fulfillment/product/{sku}` (existing)
- [ ] **PROD-04**: `list_products` — `GET /fulfillment/products` (Platform)
- [ ] **PROD-05**: `list_products_paginated` — `GET /fulfillment/products/list` (Platform)
- [ ] **PROD-06**: `sync_products_status` — `GET /fulfillment/sync-products` (Platform)
- [ ] **PROD-07**: `trigger_product_sync` — `POST /fulfillment/sync-products` (Platform)
- [ ] **PROD-08**: `trigger_single_product_sync` — `POST /fulfillment/products/{sku}/trigger-workflow` (Platform)
- [ ] **PROD-09**: `delete_products` — `DELETE /fulfillment/products` (Platform) — DESTRUCTIVE
- [x] **PROD-10**: `bulk_validate_products` — `POST /api/fulfilment/products/bulk/validate` (existing) — multipart
- [x] **PROD-11**: `bulk_commit_products` — `POST /api/fulfilment/products/bulk/commit` (existing) — multipart

### Inventory (INVT)

- [x] **INVT-01**: `list_inventory` — `GET /fulfillment/inventory` (existing, with ex-core fallback)
- [x] **INVT-02**: `get_inventory_by_sku` — inventory by SKU (existing)
- [x] **INVT-03**: `adjust_stock` — `POST /api/fulfilment/inventory/adjustments` (existing)
- [x] **INVT-04**: `list_sku_batches` — `GET /api/fulfilment/inventory/{sku}/batches` (existing)
- [x] **INVT-05**: `get_batch` — batch detail (existing)
- [ ] **INVT-06**: `get_cbm_history` — `GET /fulfillment/cbm/history` (Platform)
- [ ] **INVT-07**: `get_total_items_in_stock` — `GET /fulfillment/inventory-total` (Platform)
- [ ] **INVT-08**: `trigger_inventory_sync` — `POST /fulfillment/sync-inventory` (Platform)
- [ ] **INVT-09**: `get_inventory_sync_state` — `GET /fulfillment/sync-inventory-state` (Platform)
- [ ] **INVT-10**: `download_ex_api_inventory` — `GET /api/fulfillment/download_stock` (Ex-core) — CSV
- [ ] **INVT-11**: `export_inventory_snapshot` — `GET /fulfillment/inventory-snapshot/export` (Platform) — CSV
- [ ] **INVT-12**: `get_inventory_snapshot` — `GET /fulfillment/inventory-snapshot` (Platform)
- [ ] **INVT-13**: `run_inventory_insights` — `POST {VITE_INVENTORY_API_URL}` (n8n) — out-of-scope candidate if endpoint is not first-party

### Fulfilment Orders (FOLM)

- [x] **FOLM-01**: `create_fulfilment_order` — fulfilment order create (existing)
- [x] **FOLM-02**: `update_fulfilment_order` — fulfilment order update (existing)
- [x] **FOLM-03**: `get_fulfilment_order` — fulfilment order detail (existing)
- [x] **FOLM-04**: `add_parcel_to_order` (existing)
- [x] **FOLM-05**: `remove_parcel_from_order` (existing)
- [x] **FOLM-06**: `claims_dump` (existing)

### Shipments & Carriers (SHIP)

- [ ] **SHIP-01**: `get_shipment` — `GET /shipments` (Platform, mutation form)
- [ ] **SHIP-02**: `list_carrier_capabilities` — `GET /shipments/carriers/capabilities` (Platform) — sends `x-api-version: 20240101`
- [ ] **SHIP-03**: `update_carrier_details` — `PUT /shipments/{shipment_id}/update-carrier-details` (Platform)
- [ ] **SHIP-04**: `get_shipment_rates` — `POST /shipments/rates` (Platform)

### Shipping Profiles — Dispatcher Rule Sets (SHPR)

- [ ] **SHPR-01**: `list_dispatcher_rule_sets` — `GET /partner/dispatcher/rule-sets` (Platform)
- [ ] **SHPR-02**: `create_dispatcher_rule_set` — `POST /partner/dispatcher/rule-sets` (Platform)
- [ ] **SHPR-03**: `update_dispatcher_rule_set` — `PUT /partner/dispatcher/rule-sets/{id}` (Platform)
- [ ] **SHPR-04**: `delete_dispatcher_rule_set` — `DELETE /partner/dispatcher/rule-sets/{id}` (Platform) — DESTRUCTIVE

### Returns (RETN)

REST (Platform):

- [ ] **RETN-01**: `list_return_requests` — `GET /api/accounts/{accountID}/return-requests` (Platform)
- [ ] **RETN-02**: `list_return_reasons` — `GET /api/return-reasons` (Platform)
- [ ] **RETN-03**: `get_return_request` — `GET /api/return-requests/{requestID}` (Platform)
- [ ] **RETN-04**: `approve_return_request` — `POST /api/return-requests/{requestID}/approve` (Platform)
- [ ] **RETN-05**: `reject_return_request` — `POST /api/return-requests/{requestID}/reject` (Platform)

Supabase (Returns Hub + Client Portal):

- [ ] **RETN-06**: `get_returns_hub_metrics` — RPC `get_returns_hub_metrics()` (Supabase)
- [ ] **RETN-07**: `list_return_orders` — table `return_orders` (Supabase)
- [ ] **RETN-08**: `list_return_skus` — table `skus` (Supabase)
- [ ] **RETN-09**: `list_return_units` — table `units` (Supabase)

### Finance — Invoicer + Stripe (FIN)

Invoicer / Zoho:

- [ ] **FIN-01**: `list_zoho_invoices` — `GET /zoho/invoices` (Invoicer)
- [ ] **FIN-02**: `download_zoho_invoice` — `GET /zoho/invoice/{invoiceId}/pdf` (Invoicer) — base64 PDF
- [ ] **FIN-03**: `list_zoho_credit_notes` — `GET /zoho/credit-notes` (Invoicer)
- [ ] **FIN-04**: `download_zoho_credit_note` — `GET /zoho/creditnote/{creditNoteId}/pdf` (Invoicer) — base64 PDF
- [ ] **FIN-05**: `update_bank_details` — `PUT /accounts` (Platform) — same endpoint as AUTH-07 but constrained payload

Stripe:

- [ ] **FIN-06**: `get_stripe_setup_intent` — `GET /quiqdash/payments/setup-intent` (Platform)
- [ ] **FIN-07**: `get_stripe_customer_session` — `GET /quiqdash/payments/customer-session` (Platform)
- [ ] **FIN-08**: `get_stripe_user_state` — `GET /quiqdash/payments/users/me` (Platform)
- [ ] **FIN-09**: `list_stripe_payment_methods` — `GET /quiqdash/payments/payment-methods` (Platform)
- [ ] **FIN-10**: `get_stripe_payment_method` — `GET /quiqdash/payments/payment-methods/{id}` (Platform)
- [ ] **FIN-11**: `delete_stripe_payment_method` — `DELETE /quiqdash/payments/payment-methods/{id}` (Platform) — DESTRUCTIVE

### Notifications (NOTF)

- [ ] **NOTF-01**: `list_notifications` — `GET /quiqdash/notifications` (Platform)

### Analytics — Metabase Tokens (RPT)

- [ ] **RPT-01**: `get_metabase_report_token` — `GET /quiqdash/reports/token/{id}` (or `/token-unsafe/{id}` for Alshayaa role) (Platform)

### Internal Server Routes (SRVR)

These are this Next app's own routes (already needed by the MCP host for actor-token + downloads). Exposing them as MCP tools is mostly for parity / debugging:

- [ ] **SRVR-01**: `generate_actor_token` — `POST /api/generate-actor-token` (own server) — internal-only, may stay un-exposed
- [ ] **SRVR-02**: `download_document_proxy` — `GET /api/download-document` (own server) — same caveat

## v2 Requirements

Deferred — useful but not required for "all endpoints reachable" v1 cut.

### Bulk-action ergonomics

- **BULK-01**: `batch_change_state` higher-level tool that takes a target state + reason + order IDs and dispatches to the right ORDT-* endpoint
- **BULK-02**: `list_orders_with_filters` convenience wrapper over the orders GraphQL with structured filter args

### Eval coverage expansion

- **EVAL-01**: Langfuse eval per ORDT-* transition (currently only `create_lastmile_order` has a baseline)
- **EVAL-02**: Langfuse eval for INTG-* OAuth-callback flows

## Out of Scope

| Feature | Reason |
|---------|--------|
| `POST /chat/operationsAgent` (Mastra SSE) | Mastra IS an LLM agent; wrapping it as an MCP tool creates an agent-calling-agent loop with no value |
| `GET /api/memory/threads/{threadId}` (Mastra memory) | Same — Mastra-internal, not user-facing |
| `GET /api/health` (own server route) | Infra monitoring concern, not an agent action |
| Quiqdash v2 (legacy) endpoints | Explicit version cap; we mirror v3 only |
| New backend capabilities (endpoints not present in extract) | This project mirrors the frontend; new BE work is upstream |
| MCP server UI / dashboard | Existing landing page is sufficient |
| n8n inventory-insights webhook (INVT-13 candidate) | If the endpoint is third-party / non-Quiqup-first-party, it's marked out and tracked separately |
| Building a unified "any HTTP" passthrough tool | Defeats the point of typed, evaluated tool descriptions |

## Traceability

**Coverage:**
- v1 requirements: 115 total (incl. 32 existing)
- Already shipped: 32 ✓
- To build: 83
- Mapped to phases: 83 ✓
- Unmapped: 0 ✓

`[x]` (shipped) requirements are not mapped to a phase. INVT-13 is mapped to Phase 7 as a build candidate but tagged as a possible defer-to-out-of-scope; the decision is taken during Phase 7 planning. SRVR-01/SRVR-02 are mapped to Phase 11 with an explicit "may stay un-exposed" decision recorded in that phase's plan.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | (shipped) | Validated |
| AUTH-02 | (shipped) | Validated |
| AUTH-03 | Phase 1 | Completed (01-01) |
| AUTH-04 | Phase 1 | Completed (01-01) |
| AUTH-05 | Phase 1 | Completed (01-01) |
| AUTH-06 | Phase 1 | Completed (01-01) |
| AUTH-07 | Phase 1 | Pending |
| AUTH-08 | Phase 1 | Completed (01-01) |
| AUTH-09 | Phase 1 | Completed (01-01) |
| AUTH-10 | Phase 1 | Pending |
| AUTH-11 | Phase 1 | Pending |
| AUTH-12 | Phase 1 | Pending |
| AUTH-13 | Phase 1 | Pending |
| ADDR-01 | Phase 1 | Pending |
| ADDR-02 | Phase 1 | Pending |
| ADDR-03 | Phase 1 | Pending |
| ADDR-04 | Phase 1 | Pending |
| ADDR-05 | Phase 1 | Pending |
| ADDR-06 | Phase 1 | Pending |
| ADDR-07 | Phase 1 | Pending |
| ADDR-08 | Phase 1 | Pending |
| INTG-01 | Phase 2 | Pending |
| INTG-02 | Phase 2 | Pending |
| INTG-03 | Phase 2 | Pending |
| INTG-04 | Phase 2 | Pending |
| INTG-05 | Phase 2 | Pending |
| INTG-06 | Phase 2 | Pending |
| INTG-07 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-08 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-09 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-10 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-11 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-12 | Phase 2 / 02-02 | Complete (2026-05-19) |
| INTG-13 | Phase 2 | Pending |
| INTG-14 | Phase 2 | Pending |
| INTG-15 | Phase 2 | Pending |
| INTG-16 | Phase 2 | Pending |
| INTG-17 | Phase 2 | Pending |
| INTG-18 | Phase 2 | Pending |
| INTG-19 | Phase 1 | Completed (01-01) |
| INTG-20 | Phase 2 / Plan 02-04 | Shipped (commit 6781345) |
| INTG-21 | Phase 2 / Plan 02-04 | Shipped (commit 6781345) |
| INTG-22 | Phase 2 / Plan 02-05 | Pending (destructive — deferred to 02-05 with confirm:true gate) |
| INTG-23 | Phase 2 / Plan 02-04 | Shipped (commit 7a24f62) |
| INTG-24 | Phase 2 / Plan 02-04 | Shipped (commit 6781345) |
| INTG-25 | Phase 2 / Plan 02-04 | Shipped (commit 6781345) |
| INTG-26 | Phase 2 / Plan 02-04 | Shipped (commit 7a24f62) |
| ORDL-01 | (shipped) | Validated |
| ORDL-02 | Phase 3 | Pending |
| ORDL-03 | Phase 3 | Pending |
| ORDL-04 | Phase 3 | Pending |
| ORDL-05 | Phase 3 | Pending |
| ORDL-06 | Phase 3 | Pending |
| ORDL-07 | Phase 3 | Pending |
| ORDL-08 | Phase 1 | Pending |
| ORDL-09 | Phase 1 | Pending |
| ORDL-10 | Phase 1 | Pending |
| ORDL-11 | Phase 1 | Pending |
| ORDL-12 | Phase 1 | Pending |
| ORDS-01 | (shipped) | Validated |
| ORDS-02 | Phase 3 | Pending |
| ORDS-03 | Phase 4 | Pending |
| ORDS-04 | Phase 4 | Pending |
| ORDS-05 | Phase 3 | Pending |
| ORDS-06 | Phase 4 | Pending |
| ORDS-07 | Phase 4 | Pending |
| ORDS-08 | Phase 3 | Pending |
| ORDC-01 | (shipped) | Validated |
| ORDC-02 | (shipped) | Validated |
| ORDC-03 | (shipped) | Validated |
| ORDC-04 | Phase 4 | Pending |
| ORDC-05 | Phase 4 | Pending |
| ORDT-01 | (shipped) | Validated |
| ORDT-02 | (shipped) | Validated |
| ORDT-03 | Phase 4 | Pending |
| ORDT-04 | Phase 4 | Pending |
| ORDT-05 | Phase 4 | Pending |
| ORDT-06 | Phase 4 | Pending |
| ORDT-07 | Phase 4 | Pending |
| ORDT-08 | Phase 4 | Pending |
| ORDT-09 | Phase 4 | Pending |
| ORDT-10 | Phase 4 | Pending |
| ORDT-11 | Phase 4 | Pending |
| ORDT-12 | Phase 4 | Pending |
| ORDT-13 | Phase 4 | Pending |
| ORDT-14 | Phase 4 | Pending |
| MISS-01 | Phase 4 | Pending |
| MISS-02 | Phase 4 | Pending |
| MISS-03 | Phase 5 | Pending |
| MISS-04 | (shipped) | Validated |
| MISS-05 | Phase 5 | Pending |
| MISS-06 | Phase 5 | Pending |
| INBD-01..06 | (shipped) | Validated |
| INBD-07 | Phase 6 | Pending |
| INBD-08 | Phase 6 | Pending |
| INBD-09 | Phase 6 | Pending |
| PROD-01..03 | (shipped) | Validated |
| PROD-04 | Phase 6 | Pending |
| PROD-05 | Phase 6 | Pending |
| PROD-06 | Phase 6 | Pending |
| PROD-07 | Phase 6 | Pending |
| PROD-08 | Phase 6 | Pending |
| PROD-09 | Phase 6 | Pending |
| PROD-10 | (shipped) | Validated |
| PROD-11 | (shipped) | Validated |
| INVT-01..05 | (shipped) | Validated |
| INVT-06 | Phase 7 | Pending |
| INVT-07 | Phase 7 | Pending |
| INVT-08 | Phase 7 | Pending |
| INVT-09 | Phase 7 | Pending |
| INVT-10 | Phase 7 | Pending |
| INVT-11 | Phase 7 | Pending |
| INVT-12 | Phase 7 | Pending |
| INVT-13 | (out-of-scope candidate; decided in Phase 7 plan) | Pending |
| FOLM-01..06 | (shipped) | Validated |
| SHIP-01 | Phase 8 | Pending |
| SHIP-02 | Phase 8 | Pending |
| SHIP-03 | Phase 8 | Pending |
| SHIP-04 | Phase 8 | Pending |
| SHPR-01 | Phase 8 | Pending |
| SHPR-02 | Phase 8 | Pending |
| SHPR-03 | Phase 8 | Pending |
| SHPR-04 | Phase 8 | Pending |
| RETN-01 | Phase 9 | Pending |
| RETN-02 | Phase 9 | Pending |
| RETN-03 | Phase 9 | Pending |
| RETN-04 | Phase 9 | Pending |
| RETN-05 | Phase 9 | Pending |
| RETN-06 | Phase 9 | Pending |
| RETN-07 | Phase 9 | Pending |
| RETN-08 | Phase 9 | Pending |
| RETN-09 | Phase 9 | Pending |
| FIN-01 | Phase 10 | Pending |
| FIN-02 | Phase 10 | Pending |
| FIN-03 | Phase 10 | Pending |
| FIN-04 | Phase 10 | Pending |
| FIN-05 | Phase 10 | Pending |
| FIN-06 | Phase 10 | Pending |
| FIN-07 | Phase 10 | Pending |
| FIN-08 | Phase 10 | Pending |
| FIN-09 | Phase 10 | Pending |
| FIN-10 | Phase 10 | Pending |
| FIN-11 | Phase 10 | Pending |
| NOTF-01 | Phase 11 | Pending |
| RPT-01 | Phase 11 | Pending |
| SRVR-01 | Phase 11 | Pending |
| SRVR-02 | Phase 11 | Pending |

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 — Traceability populated by roadmap*
