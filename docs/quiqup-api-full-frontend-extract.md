# Quiqdash v3 — API Endpoints Inventory

This document catalogs every backend endpoint consumed by the Quiqdash v3 frontend, the hook/file that triggers it, and the business action it powers. It was assembled by scanning `app/hooks/**`, `app/routes/**`, `app/graphql/**`, `app/lib/operations/**` and `app/components/chat/**`.

Endpoint paths use OpenAPI templating (`{param}`) for path params. "Triggered by" points to the hook/file that owns the call; route components consume those hooks. Where a hook ships a hard-cast path (`as any`) the endpoint isn't in the generated OpenAPI types yet — the cast is preserved in the listing.

---

## 0. API Infrastructure Overview

### Base URLs (`app/lib/env.ts`)

All client-side URLs flow through `app/lib/env.ts` from `VITE_*` env vars and are exposed by `app/hooks/useAuthenticatedApi.tsx` (`API_URLS`):

| Logical name | Env var | `useXxxApi` factory | Notes |
| --- | --- | --- | --- |
| Platform API (Go monolith — Quiqdash BFF) | `VITE_PLATFORM_BASE_URL` | `usePlatformApi` | Default for most hooks. |
| Ex-core (legacy Ruby `ex-core`) | `VITE_EX_API_BASE_URL` | `useExApi` | Old REST endpoints (downloads, inventory fallback). |
| Quiqup public API | `VITE_QUIQUP_API_BASE_URL` | `useQuiqupApi` | Order history + export endpoints. |
| Quiqup GraphQL (label PDFs) | `VITE_QUIQUP_GRAPHQL_BASE_URL` | `useQuiqupGraphql` | Hosts `/pending_orders_labels`, `/order_label/...`. |
| Orders Core REST | `VITE_ORDERS_API_BASE_URL` (falls back to `ORDERS_API_GRAPH_URL` minus `/graph`) | `useOrdersApi` | `/orders-by-client-id/...`. |
| Orders Core GraphQL | `VITE_ORDERS_API_GRAPH_URL` | Relay environment | `app/graphql/provider.tsx`. |
| Invoicer | `VITE_INVOICER_BASE_URL` | `useInvoicerApi` | Zoho invoice/credit-note endpoints. |
| Finance | `VITE_FINANCE_BASE_URL` | `useFinanceApi` | Reserved (currently unused by hooks). |
| Audit | `VITE_AUDIT_BASE_URL` | direct `fetch` | Per-resource event log. |
| Metabase | `VITE_METABASE_URL` | iframe + token endpoint | Analytics dashboards. |
| Mastra (AI agent) | `VITE_MASTRA_URL` | `app/lib/mastra-client.ts` | Chat panel streaming. |
| Google Places | `VITE_PLACES_BASE_URL` | direct `fetch` | Place details lookup. |
| Supabase (Returns Hub) | `VITE_SUPABASE_URL` | `app/lib/operations/supabase.ts` + `useSupabaseClient` | Returns tables + RPCs. |

### Service hosts per environment

Concrete URLs for each logical service. Staging values are from `.env.example`; production values are from `deliver_vars/frontend/production/values.yaml` (the Helm chart's env block). Secrets (`VITE_*_KEY`, `VITE_*_PUBLISHABLE_KEY`) live alongside in SOPS-encrypted `secrets.yaml` and aren't reproduced here.

| Service | Staging | Production |
| --- | --- | --- |
| Platform API | `https://platform-api.staging.quiqup.com` | `https://platform-api.quiqup.com` |
| Quiqup public REST | `https://api.staging.quiqup.com` | `https://api-ae.quiqup.com` *(regional suffix)* |
| Quiqup GraphQL (label PDFs) | `https://graph.staging.quiqup.com` | `https://graph.quiqup.com` |
| Orders Core GraphQL | `https://orders-api.staging.quiqup.com/graph` | `https://orders-api.quiqup.com/graph` |
| Ex-core | `https://ex-api.staging.quiqup.com` | `https://ex-api.quiqup.com` |
| Invoicer (Zoho wrapper) | `https://invoicer-api.staging.quiqup.com` | `https://invoicer-api.quiqup.com` |
| Finance | `https://fin-api.quiqup.com` | `https://fin-api.quiqup.com` *(same host both envs)* |
| Audit | `https://audit.staging.quiqup.com` | `https://audit.quiqup.com` |
| Mastra (AI agent) | `http://localhost:4000` *(no staging host — local Mastra)* | `https://quiqdash-ai.quiqup.com` |
| Supabase (Returns) | `https://oarvjggfedvnncozoisr.supabase.co` *(dev project)* | `https://boasbgedugelzthqomoy.supabase.co` *(prod project)* |
| Metabase | `https://metabase.dev.quiq.ly` | `https://reports.quiqup.com` |
| Legacy QD (v2 dashboard this app replaces) | `https://quiqdash.staging.quiqup.com` | `https://business-ae.quiqup.com` |
| Google Places | `https://places.googleapis.com` | `https://places.googleapis.com` |
| This app's own host | — | `https://business-ae-beta.quiqup.com` |

Notes:
- The Quiqup REST host carries a regional suffix in production (`api-ae` = UAE). Other regions (e.g. `-sa` for Saudi) would point to separate deployments — check if you're investigating region-specific behaviour.
- `openapi.json` for the Platform service is presumably served at `<platform-host>/openapi.json` (that's how `app/lib/api/openapi.json` is regenerated via `bun gen:types`). Other services don't currently publish a public OpenAPI spec — see §19 B–D for inferred shapes.
- To rotate or read a SOPS-encrypted secret: `sops deliver_vars/frontend/<env>/secrets.yaml` (decrypt via GCP KMS, edit, save — sops re-encrypts on close per `.sops.yaml`).

### Auth pattern

`useAuthenticatedApi(baseUrl)` (`app/hooks/useAuthenticatedApi.tsx:31`) is the single source of authenticated API clients:

1. Reads a JWT from Clerk via `getToken({ template: "default" })`.
2. Builds an `openapi-fetch` client typed against `app/lib/api/v1` (generated from OpenAPI) and wraps it with `openapi-react-query` so callers get `api.useQuery` / `api.useMutation` typed by path.
3. Attaches `Authorization: Bearer <token>` and `Content-Type: application/json` on every call.
4. Short-circuits to a synthetic 401 when the token isn't ready, and to a synthetic 400 when the consumer passes `enabled: false` — keeps query keys stable without firing the network.

Direct `fetch` calls (used for blob downloads / multipart uploads where openapi-fetch is awkward) read `baseUrl` and `token` off the same hook so the auth header stays consistent.

### Service factories

- `usePlatformApi`, `useExApi`, `useQuiqupApi`, `useQuiqupGraphql`, `useInvoicerApi`, `useFinanceApi`, `useOrdersApi` — each is `useAuthenticatedApi(API_URLS.<name>)`.

### Mastra (chat) auth

`mastraFetch(path, opts, getToken)` (`app/lib/mastra-client.ts`) attaches the Clerk token and transparently retries once on 401 with a freshly minted token before throwing `AuthenticationError`. The chat panel streams the agent via `POST {MASTRA_URL}/chat/operationsAgent` (the `useChat` SDK handles SSE).

### Relay

`app/graphql/provider.tsx` configures a Relay `Environment` against `VITE_ORDERS_API_GRAPH_URL`, also signed with the Clerk JWT. Queries live in `app/graphql/queries/`.

### Supabase

`app/lib/operations/supabase.ts` instantiates a Supabase JS client; `app/hooks/fulfillment/returns/useSupabaseClient.ts` exposes a tokenized client factory used by the Returns Hub hooks.

---

## 1. Auth, Account, Permissions, Signup, Impersonation

### `GET /account`
- **Triggered by:** `app/hooks/account/use-account.tsx:23` → `useAccount` (`app/layouts/...`)
- **Purpose:** Fetches the signed-in user's account on app boot, populates `useAccountStore`, then triggers feature-flag fetch.
- **Response:** Account profile (id, name, settings, service offering).
- **Source:** REST (platform).

### `GET /me`
- **Triggered by:** `app/hooks/account/use-account.tsx:151` → `useGetMe`
- **Purpose:** Loads the authenticated user record (separate from `account`) and stores it in `useMeStore`. Sends `x-api-version: 1`.
- **Source:** REST (platform).

### `GET /permissions`
- **Triggered by:** `app/hooks/auth/use-permissions.tsx:17` → `usePermissions`
- **Purpose:** Loads the user's permission list into `usePermissionsStore`; powers `<PermissionGuard>` route gating. Sends `x-api-version: 1`.
- **Source:** REST (platform).

### `GET /accounts/{id}/capabilities`
- **Triggered by:** `app/hooks/account/use-account.tsx:93` (`useGetAccountCapabilities` — mutation form) and `:100` (`useGetAccountCapabilitiesOnLoad` — query form, `id="me"`)
- **Purpose:** What this account can do (fulfillment enabled, WMS setup complete, etc.) — drives feature gates on the dashboard.
- **Source:** REST (platform).

### `GET /accounts/{id}`
- **Triggered by:** `app/hooks/account/use-account.tsx:173` → `useGetAccountBySFID`
- **Purpose:** Resolve an account by Salesforce ID (used in admin tools).
- **Source:** REST (platform).

### `PUT /accounts`
- **Triggered by:** `app/hooks/account/use-account.tsx:127` (`useUpdateAccount`) and `app/hooks/finance/use-finance.tsx:127` (`useUpdateBankDetails`)
- **Purpose:** Update account profile (general settings) or bank-details subset (finance section). Invalidates `["get", "/account"]`.
- **Source:** REST (platform).

### `GET /quiqup/service-kinds`
- **Triggered by:** `app/hooks/account/use-account.tsx:114` → `useGetServiceKinds`
- **Purpose:** Lookup list of service kinds (express, standard, returns, …) for selectors across the app.
- **Source:** REST (platform).

### `GET /quiqdash/init`
- **Triggered by:** `app/hooks/user-config/user-config.tsx:17` → `useUserConfig`
- **Purpose:** App-boot config bundle (roles, feature toggles, currency). Populates `useUserConfigStore`; downstream analytics + UI flags read from it.
- **Source:** REST (platform).

### `POST /featureflags/decide-bulk`
- **Triggered by:** `app/hooks/feature-flag/use-feature-flag.tsx:8` → `useFetchFeatureFlags` (called by `useAccount`)
- **Purpose:** Evaluate the full feature-flag set for the current identifier. Body: `{ Features: string[], Identifier: string }`. Defaults to all-enabled on failure (graceful degradation).
- **Source:** REST (platform).

### `GET /api/accounts/{accountID}/return-settings`
- **Triggered by:** `app/hooks/account/use-return-settings.ts:14` → `useGetReturnSettings`
- **Purpose:** Load account's return policy (window, allowed reasons) for the Returns settings page.
- **Source:** REST (platform).

### `PUT /api/accounts/{accountID}/return-settings`
- **Triggered by:** `app/hooks/account/use-return-settings.ts:48` → `useUpdateReturnSettings`
- **Purpose:** Save edits to the return policy.
- **Source:** REST (platform).

### `POST /partner/register`
- **Triggered by:** `app/hooks/signup/use-signup.tsx:7` → `useSignup`
- **Purpose:** Registers a new partner account at the end of the signup wizard.
- **Source:** REST (platform).

### `POST /account/team`
- **Triggered by:** `app/hooks/clerk/use-create-team.tsx:7` → `useCreateTeam`
- **Purpose:** Provision a Clerk team / org binding for the account post-signup.
- **Source:** REST (platform).

### `POST /api/generate-actor-token` (server route)
- **Triggered by:** `app/routes/impersonate/page.tsx:132`
- **Implements:** `app/routes/api/generate-actor-token.ts` — verifies the caller is a Quiqup org member, looks up the target user by email via Clerk Backend SDK, then returns a Clerk actor token + sign-in URL.
- **Purpose:** Lets Quiqup ops staff impersonate a partner for support.
- **Source:** Internal RR loader/action → Clerk Backend SDK.

### `GET /api/health` (server route)
- **Implements:** `app/routes/api/health.ts`
- **Purpose:** Liveness probe for Kubernetes. Always returns 200.
- **Source:** Internal RR loader.

### `GET /api/download-document` (server route)
- **Implements:** `app/routes/api/download-document.ts`
- **Purpose:** Authenticated proxy that streams a document from GCS/S3/Azure Blob back to the browser, allowlisting hostnames and content types. Used by the order-details documents card to download proof-of-delivery / commercial invoices safely.
- **Source:** Internal RR loader.

---

## 2. Integrations (Shopify, WooCommerce, Salla, generic)

### `GET /integrations/connections`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:41` (`useIntegrationConnections`) and `:135` (`useGetConnections`)
- **Purpose:** Lists all storefront connections the account has authorized.
- **Source:** REST (platform).

### `DELETE /{source}/delete/{shopName}`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:188` → `useDeleteConnection`
- **Purpose:** Generic disconnect for Shopify/WooCommerce by source. Invalidates connections list.
- **Source:** REST (platform).

### `GET /integrations/order-reasons`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:242` → `useGetIntegrationOrdersOnLoad` (query params: `sales_channel`, `status`, `start_date`, `end_date`, `user_id`, `limit`, `offset`)
- **Purpose:** Paginated list of recently-failed integration orders along with the reason — feeds the Integrations "needs repair" table.
- **Source:** REST (platform).

### `POST /integrations/repair-orders`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:267` → `useRepairIntegrationOrder`
- **Purpose:** Retries / repairs failed integration orders selected in the table.
- **Source:** REST (platform).

### `GET /order/{orderUUID}`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:9` → `useIntegration` (mutation-style GET)
- **Purpose:** Refetch an integration order by UUID to update local state after repair.
- **Source:** REST (platform).

### `POST /orders/confirm-ff-export`
- **Triggered by:** `app/hooks/integration/use-integration.tsx:18` → `useConfirmOrder`
- **Purpose:** Confirms a fulfillment-export order from the order-details page (manual override).
- **Source:** REST (platform).

#### Shopify
- `GET /shopify/config/{shopName}` — `useGetShopifyConfig` (mutation) and `useGetShopifyConfigOnLoad` (query) at lines 50/56. Load saved shop config.
- `GET /shopify/delivery-methods?shop_name=` — `useGetShopifyDeliveryMethods` (line 85). Read shop's shipping methods.
- `GET /shopify/locations?shop_name=` — `useGetShopifyLocations` (line 120). List ship-from locations.
- `PUT /shopify/config` — `useUpdateShopifyConfig` (line 145). Save mapping config (delivery methods, locations, …).
- `PUT /shopify/connection` — `useUpdateShopifyConnection` (line 167). Update connection meta.
- `POST /shopify/callback` — `useSetupShopifyConnection` (line 173). OAuth callback handoff.

#### WooCommerce
- `GET /woocommerce/connections` — `useGetWoocommerceConnections` (line 70).
- `GET /woocommerce/config/{siteName}` — `useGetWoocommerceConfig` (line 79).
- `GET /woocommerce/states` — `useGetWoocommerceStates` (line 98).
- `GET /woocommerce/shipping-lines` — `useGetWoocommerceShippingLines` (line 106).
- `POST /woocommerce/connection` — `useSetupWooCommerceConnection` (line 179). OAuth completion.
- `PUT /woocommerce/settings/config/upsert` — `useUpdateWoocommerceConfig` (line 212).

#### Quiqup integration helpers
- `GET /quiqup/orders/states` — `useGetQuiqupStates` (line 112). Lookup of order states for filter dropdowns.

#### Salla (REST, direct `fetch` via React Query — `app/hooks/integration/use-salla-integration.tsx`)
- `GET /integrations/install/salla` → `useInstallSalla` (line 65). Returns `{ url }` to redirect into Salla's OAuth.
- `GET /integrations/connections/{id}` → `useGetSallaConnection` (line 88). Unwraps `{ connection }` envelope.
- `DELETE /integrations/connections/{id}` → `useDeleteSallaConnection` (line 102). Disconnect.
- `PUT /integrations/connections/{id}/fulfillment` → `useToggleSallaFulfillment` (line 144). Toggle fulfillment mode after OAuth.
- `GET /integrations/configs/{connectionId}/platform-data` → `useGetSallaPlatformData` (line 187). Pulls shipping methods + locations from Salla via adapter.
- `GET /integrations/configs/{connectionId}` → `useGetSallaConfig` (line 207). 404 is the "no config yet" path.
- `PUT /integrations/configs/{connectionId}` → `useUpdateSallaConfig` (line 233). Save mapping config.

Note: Salla calls use an `AbortSignal.timeout(15s)` and a typed `HttpError` so callers can branch on status (404 vs 5xx).

---

## 3. Addresses, Countries, Cities, States, Places

### `GET /accounts/{id}/addresses`
- **Triggered by:** `app/hooks/addresses/use-addresses.tsx:8` → `useAddresses` (id="me") and `app/routes/account/addresses/page.tsx:37`.
- **Purpose:** Address book listing for the account.
- **Source:** REST (platform).

### `POST /partner/addresses`
- **Triggered by:** `app/hooks/addresses/use-addresses.tsx:23` → `useCreateAddress`. Invalidates the addresses list.

### `PATCH /partner/addresses/{id}`
- **Triggered by:** `app/hooks/addresses/use-addresses.tsx:49` → `useUpdateAddress`.

### `GET /countries`
- `app/hooks/data/use-countries.tsx:7` (`useGetCountries`) and `app/hooks/order/use-orders.tsx:171` (`fetchCountriesMap` — used during CSV export to resolve ISO2 → country names).

### `GET /countries/{countryIso2}/states`
- `app/hooks/data/use-states.tsx:7` (mutation form) and `:13` (`useGetStatesOnLoad`). Lookup of states for a country selector.

### `GET /countries/{countryNameOrIso2}/cities` (mutation form)
- `app/hooks/data/use-cities.tsx:7` → on-demand city lookup.

### `GET /countries/{countryIso2}/states/{stateNameOrCode}/cities`
- `app/hooks/data/use-cities.tsx:14` (query) and `:29` (mutation). City lookup per state.

### `GET {VITE_PLACES_BASE_URL}/v1/places/{placeId}` (Google Places)
- `app/hooks/data/use-google-apis.tsx:10` → `useFetchPlaceDetails`. Resolves a `place_id` from Google Maps autocomplete into formatted address + display name; powers the create-order address autocomplete.

---

## 4. Orders — Listing & Filters

### GraphQL `ordersListingQuery` (`app/graphql/queries/orders-listing.query.ts`)
- **Triggered by:** `app/hooks/order/use-orders.tsx:22` → `useOrdersGraphQL` (Relay `useLazyLoadQuery`).
- **Purpose:** Paginated orders list for the Orders dashboard, filtered by the values produced by `buildOrderFilters(searchFilter)` plus date range. Supports cursor pagination (`first/after` and `last/before`) and `orderBy: { field: SUBMITTED_AT, direction: ASC|DESC }`. Returns origin/destination, status, payment, items.
- **Source:** GraphQL (Orders Core, via Relay).

### GraphQL `ordersListingIdsQuery`
- **Triggered by:** Same file — used to fetch just clientOrderIDs in bulk for select-all operations.
- **Source:** GraphQL.

### GraphQL `bulkOrdersLookupQuery` (`app/graphql/queries/bulk-orders-lookup.query.ts`)
- **Triggered by:** Bulk Weight Update modal + Bulk Mission Add-by-ID flow (see Bulk Operations below).
- **Purpose:** Re-fetches a list of orders by `clientOrderIDIn` to include weights and parcel items not returned by the listing query.
- **Source:** GraphQL.

### `GET /quiqdash/orders/find_by_id_or_barcode`
- **Triggered by:** `app/hooks/order/use-bulk-change-state.ts:42` → `useFindOrderByIdOrBarcode`
- **Purpose:** Single-order lookup for badge inputs (bulk change state / bulk mission modals). `intention` query param tells BE which target state we're checking compatibility against.
- **Source:** REST (platform).

### `GET /quiqdash/depots?region=&mainDepot=`
- **Triggered by:** `app/hooks/order/use-order-management.ts:12` → `useDepots`
- **Purpose:** Depot list for the Bulk Mission dialog. Stays disabled until a region is selected.
- **Source:** REST (platform proxy → ex-core).

### `GET /quiqdash/missions?value=`
- **Triggered by:** `app/hooks/order/use-order-management.ts:71` → `useListMissions`
- **Purpose:** Search missions by name/ID for the Transfer Mission picker.
- **Source:** REST (platform proxy → ex-core).

### `GET /orders/download?from=&to=&filters[order_id]=&per_page=` (ex-core)
- **Triggered by:** `app/hooks/order/use-orders.tsx:504` → `useDownloadSelectedOrders`
- **Purpose:** Streams a CSV of selected orders. Saves blob as `selected-orders.csv`.
- **Source:** REST (ex-core).

### `GET /orders/partner-cancellation-reasons`
- **Triggered by:** `app/hooks/order/use-orders.tsx:747` → `useGetCancellationReasons`
- **Purpose:** Dropdown options for the cancel-order dialog (cast `as any` — endpoint not in OpenAPI yet).
- **Source:** REST (platform).

### Order reason lookups (used inside Bulk Change State dialog)
All via `app/hooks/order/use-bulk-change-state.ts` → `useChangeStateReasons`:
- `GET /quiqdash/orders/states/on_hold_reasons?service_kind=` (`on_hold` / `return_on_hold`).
- `GET /quiqdash/orders/states/return_to_origin_reasons` (`return_to_origin`).
- `GET /quiqdash/orders/cancellation-reasons` (`cancellation`).
- `GET /quiqdash/courier/delivery_failure_reasons?delivery_type=` (`delivery_failed` / `collection_failed`).

All return `{ reasons: [...] }` and populate the reason dropdown.

---

## 5. Orders — Single Order Details

### GraphQL `orderDetailsQuery` (`app/graphql/queries/order-details.query.ts`)
- **Triggered by:** `app/hooks/order-details/use-order-details-graphql.ts:20` → `useOrderDetailsGraphQL(clientOrderId)`
- **Purpose:** Full order detail view — addresses, items, products, state timestamps, payment, tracking, fulfillment IDs.
- **Source:** GraphQL (Orders Core via Relay, `fetchPolicy: store-and-network`).

### `GET /orders/{id}/history` (`useQuiqupApi`)
- **Triggered by:** `app/hooks/order/use-orders.tsx:624` → `useGetOrderHistory`
- **Purpose:** Timeline of state transitions for the order-details history panel.
- **Source:** REST (Quiqup public API).

### `PUT /orders/export/{id}` (`useQuiqupApi`)
- **Triggered by:** `app/hooks/order/use-orders.tsx:646` → `useUpdateOrder`
- **Purpose:** Edits an exported (international) order — body shape mirrors the order-edit form.
- **Source:** REST (Quiqup public API).

### `PATCH /api/fulfilment/orders/{id}`
- **Triggered by:** `app/hooks/order/use-orders.tsx:676` → `useUpdateFulfillmentOrder`
- **Purpose:** Edits a fulfillment order (domestic). Invalidates `["orders"]`.
- **Source:** REST (platform).

### `GET {AUDIT_BASE_URL}/events?resourceID.eq={orderUuid}`
- **Triggered by:** `app/hooks/order/use-orders.tsx:709` → `useGetAuditLog`
- **Purpose:** Audit log for the order-details page (changes by who/when). Uses no auth header — public read or service-internal.
- **Source:** REST (Audit service).

### `POST /quiqdash/order-charge`
- **Triggered by:** `app/hooks/order/use-orders.tsx:760` → `useGetOrderCharges`
- **Purpose:** Compute price/charges for the order edit flow.
- **Source:** REST (platform).

### `PATCH /quiqdash/orders/{orderId}/weight`
- **Triggered by:** `app/hooks/order/use-update-order-weight.ts:17` → `useUpdateOrderWeight`
- **Purpose:** Update parcel/item weights for an order. BE matches items by `(name, parcel_barcode)` and recomputes `weight_grams` from the array.
- **Source:** REST (platform).

### `POST /orders-by-client-id/{clientOrderID}/documents` (Orders REST)
- **Triggered by:** `app/hooks/order/use-upload-proof-of-delivery.ts:39` → `useUploadProofOfDelivery`
- **Purpose:** Multipart upload of proof-of-delivery file (`file`, `document_type=proof_of_delivery`, `admin_override=true`).
- **Source:** REST (Orders Core — base URL derived from `ORDERS_API_GRAPH_URL` minus `/graph`).

---

## 6. Orders — Creation (single + B2B + fulfillment)

### `POST /quiqdash/orders`
- **Triggered by:** `app/hooks/order/use-create-order.tsx:17` → `useCreateOrder`
- **Purpose:** Creates a single delivery order from the Create Order wizard. Invalidates `["orders"]` and toasts success/failure.
- **Source:** REST (platform).

### `POST /internal/fulfilment/orders`
- **Triggered by:** `app/hooks/order/use-create-order.tsx:59` → `useCreateFulfillmentOrder`
- **Purpose:** Creates a fulfillment order (B2B / WMS). Parses the structured invalid-SKU error response so the form can highlight offending rows inline.
- **Source:** REST (platform).

### `POST /quiqdash/bulk_orders` (multipart)
- **Triggered by:** `app/hooks/bulk-upload/use-bulk-upload.tsx:14` → `useBulkUpload`
- **Purpose:** CSV bulk order upload. Body is a single `file` form field.
- **Source:** REST (platform).

(B2B order creation reuses the same hooks above; `app/routes/create-b2b-order/**` is a wrapper UI that ultimately calls `useCreateOrder` / `useCreateFulfillmentOrder`.)

---

## 7. Orders — Status Transitions (Bulk Change State)

All defined in `app/hooks/order/use-bulk-change-state.ts:129-141` (`useBulkChangeState`). Each is a typed proxy under `/quiqdash/orders/batch/...`:

- `PUT /quiqdash/orders/batch/set_ready_for_collection`
- `PUT /quiqdash/orders/batch/set_collected`
- `PUT /quiqdash/orders/batch/set_received_at_depot`
- `PUT /quiqdash/orders/batch/set_at_depot`
- `PUT /quiqdash/orders/batch/set_in_transit`
- `PUT /quiqdash/orders/batch/set_scheduled`
- `PUT /quiqdash/orders/batch/set_delivery_complete`
- `PUT /quiqdash/orders/batch/set_on_hold`
- `PUT /quiqdash/orders/batch/set_return_to_origin`
- `PUT /quiqdash/orders/batch/set_returned_to_origin`
- `PUT /quiqdash/orders/batch/set_cancelled`
- `PUT /quiqdash/orders/batch/set_delivery_failed`
- `PUT /quiqdash/courier/orders/set_collection_failed`

Each accepts a typed body (order IDs + optional reason/UID); the hook dispatches to the right mutation based on the dialog's discriminated form value. Used both from the orders table's bulk-action toolbar and the order-details page actions.

### Convenience wrappers (single endpoints)
- `PUT /quiqdash/orders/batch/set_ready_for_collection` — `app/hooks/order/use-orders.tsx:319` (`useMarkAsReadyForCollection`). Adds payment-required toast/action when the BE responds with a billing error so the Stripe modal can open.
- `PUT /quiqdash/orders/batch/set_cancelled` — `app/hooks/order/use-orders.tsx:595` (`useCancelOrderBatch`).
- `PUT /quiqdash/missions/unpool/orders/{orderUUID}` — `app/hooks/order/use-orders.tsx:569` (`useUnpoolOrder`). Removes an order from its mission.

---

## 8. Orders — Missions, Labels, Slips

### `POST /quiqdash/missions`
- **Triggered by:** `app/hooks/order/use-order-management.ts:35` → `useCreateMission`
- **Purpose:** Creates a mission (pickup/depot/etc.) for selected orders. Body: `{ orderIds, type, depot?, zone? }`.
- **Source:** REST (platform).

### `PUT /quiqdash/missions/transfer/{missionID}`
- **Triggered by:** `app/hooks/order/use-order-management.ts:51` → `useTransferMissionOrders`
- **Purpose:** Transfer selected orders to an existing mission. Body: `{ orderIds }`.
- **Source:** REST (platform).

### `GET /pending_orders_labels` (`useQuiqupGraphql` baseUrl — returns PDF)
- **Triggered by:** `app/hooks/order/use-orders.tsx:373` → `useDownloadPendingLabels`. Saves blob as `pending-orders.pdf`.

### `GET /order_label/{order_ids}` (`useQuiqupGraphql` baseUrl — PDF)
- **Triggered by:** `app/hooks/order/use-orders.tsx:424` → `useDownloadSelectedLabels`. Downloads shipping labels for selected orders.

### `GET /return_order_label/{orderId}` (`useQuiqupGraphql` baseUrl — PDF)
- **Triggered by:** `app/hooks/order/use-orders.tsx:472` → `useDownloadReturnLabel`. Downloads the return label.

### `GET /slips/{slipType}?order_ids=...` (platform; PDF)
- **Triggered by:** `app/hooks/order/use-slips-download.tsx:28` → `useDownloadSlip("picking-list" | "packing-list")`. Sends `api-version: 20180108`.

---

## 9. Inbound (warehouse receiving)

All in `app/hooks/inbound/use-inbound.tsx`:

- `GET /api/fulfilment/slots/available?warehouse_code=&start_time=&end_time=` (line 25) — `useGetAvailableTimeSlots`. Available booking slots for an inbound.
- `POST /fulfillment/inbound/book` (line 47) — `useCreateInbound`. Books an inbound; uses the internal `/fulfillment` path because it accepts `content_base64` on documents (the public `/api/fulfilment` variant silently drops it).
- `GET /api/fulfilment/inbounds?page=&limit=&sort=&sort_desc=&type=&client_id=` (line 70) — `useGetInboundList`.
- `GET /api/fulfilment/inbound/{id}` (line 92) — `useGetInboundDetails`.
- `GET /api/fulfilment/inbound/{id}/state-history` (line 106) — `useGetInboundStateHistory`.
- `GET /accounts/{accountId}/facility` (line 120, accountId="me") — `useGetAccountFacility`. The account's assigned warehouse.
- `POST /api/fulfilment/inbounds/{id}/cancel` (line 136) — `useCancelInbound`.
- `PATCH /fulfillment/inbounds/{id}` (line 167) — `useEditInbound`. Same `/fulfillment` rationale as create.

---

## 10. Fulfillment — Products, Inventory, Stock

### Products (`app/hooks/fulfillment/use-products.tsx`)
- `POST /api/fulfilment/products` (line 31) — `useProducts.createProduct`.
- `PUT /fulfillment/products` (line 55) — `useProducts.upsertProduct`.
- `GET /fulfillment/products` (line 97) — `useGetProducts`.
- `GET /fulfillment/products/list?limit=&page=&sku=&product_name=&status=&source=&vendor=&...` (line 122) — `useGetProductsList`.
- `GET /fulfillment/sync-products` (line 148) — `useSyncProducts`. (Trigger via GET — server-side sync.)
- `GET /fulfillment/product/{sku}` (line 156) — `useGetProduct` and (`:221`) `useGetSubProduct`.
- `POST /fulfillment/sync-products` (line 171) — `useTriggerProductSync`. Manual full re-sync.
- `POST /fulfillment/products/{sku}/trigger-workflow` (line 196) — `useTriggerSingleProductSync`.
- `DELETE /fulfillment/products` (line 231) — `useDeleteProducts`.

### Bulk product upload (multipart) — `app/hooks/fulfillment/use-bulk-product-upload.tsx`
- `POST /api/fulfilment/products/bulk/validate` (line 58) — `validateFile`. Returns per-row validation status.
- `POST /api/fulfilment/products/bulk/commit` (line 88) — `commitFile`. Commits validated CSV; `update_duplicates` form field controls upsert behavior.

### Inventory (`app/hooks/fulfillment/use-inventory.tsx`)
- `GET /fulfillment/inventory` or `GET /api/fulfilment/inventory` (line 46) — `useGetInventoryOnLoad`. Toggles client by `wms_ff_setup_completed` flag (platform vs ex-core fallback).
- `GET /fulfillment/inventory` (line 58, mutation form) — `useGetInventory`.
- `GET /fulfillment/cbm/history?from=&to=` (line 69) — `useGetCBMHistory`. 6-month CBM trend.
- `GET /fulfillment/inventory-total` (line 84) — `useGetTotalItemsInStock`.
- `POST /fulfillment/sync-inventory` (line 146) — `useSyncInventory`.
- `GET /fulfillment/sync-inventory-state` (line 167) — `useCheckStockStatus`.
- `GET {EX_API}/api/fulfillment/download_stock` (line 187) — `useDownloadExApiInventory`. CSV download via `useExApi`.

### Inventory snapshot — `app/hooks/fulfillment/use-inventory-snapshot.tsx`
- `GET /fulfillment/inventory-snapshot/export` (line 20, mutation) — `useExportInventorySnapshotCsv`.
- `GET /fulfillment/inventory-snapshot?date=&page=&limit=&sku=&search=&bucket=` (line 37) — `useGetInventorySnapshot`. Historic snapshot lookup.

### Batch inventory — `app/hooks/fulfillment/use-batch-inventory.ts`
- `GET /api/fulfilment/inventory/{sku}/batches?batch_number=&expiring_before=` — `useGetBatchInventory`. Per-SKU batch listing for expiry tracking.

### Stock adjustments — `app/hooks/fulfillment/use-stock-adjustment.ts`
- `POST /api/fulfilment/inventory/adjustments` — `useStockAdjustment`. Adjusts stock counts; invalidates `["inventory-movements"]` and the per-SKU product query.

### Inventory insights (n8n webhook) — `app/routes/fulfillment/inventory-insights/use-inventory-insights.ts`
- `POST {VITE_INVENTORY_API_URL || https://n8n.dev.quiq.ly/webhook/inventory-analysis}` — runs the AI inventory-analysis workflow. (Direct fetch.)

---

## 11. Shipments & Carriers

### `GET /shipments` (mutation form)
- **Triggered by:** `app/hooks/shipment/use-shipment.tsx:9` → `useGetShipment`
- **Purpose:** Resolve a shipment by `client_order_id`/`shipment_id` query — used by the order-details shipment card and the RFC payment fallback path.

### `GET /shipments/carriers/capabilities`
- `app/hooks/shipment/use-shipment.tsx:18` (`useGetShipmentCapabilities`) and `app/hooks/shipment/use-carriers.tsx:31` (`useGetCarriers`, sends `x-api-version: 20240101`).
- **Purpose:** What each carrier supports (COD countries, dangerous goods, incoterms). Powers the carrier selector in Create Order.

### `PUT /shipments/{shipment_id}/update-carrier-details`
- `app/hooks/shipment/use-shipment.tsx:31` → `useUpdateCarrierDetails`. Edit tracking number / carrier on a shipment.

### `POST /shipments/rates`
- `app/hooks/shipment/use-shipment.tsx:54` → `useGetShipmentRate`. Live rate quote during Create Order.

---

## 12. Shipping Profiles (Dispatcher Rule Sets)

All in `app/hooks/shipping-profiles/use-shipping-profiles.tsx`:
- `GET /partner/dispatcher/rule-sets` (line 9) — list.
- `POST /partner/dispatcher/rule-sets` (line 72) — create.
- `PUT /partner/dispatcher/rule-sets/{id}` (line 22) — update.
- `DELETE /partner/dispatcher/rule-sets/{id}` (line 47) — delete.

Powers the Shipping Profiles settings page (rules that decide which carrier handles which order).

---

## 13. Returns

### REST (Platform) — Return Requests (`app/hooks/returns/use-return-requests.ts`)
- `GET /api/accounts/{accountID}/return-requests?status=&date_from=&date_to=&reason_code=&client_order_id=&sort_by=&sort_desc=&page=&per_page=` (line 32) — `useReturnRequestList`. Gated by feature flag `customer-returns`.
- `GET /api/return-reasons` (line 63) — `useReturnReasons`.
- Same listing with `status=pending` + `client_order_id` (line 88) — `useReturnRequestForOrder`. Lookup the pending return request for a specific order.
- `GET /api/return-requests/{requestID}` (line 116) — `useReturnRequestDetail`.
- `POST /api/return-requests/{requestID}/approve` (line 132) — `useApproveReturnRequest`.
- `POST /api/return-requests/{requestID}/reject` (line 154) — `useRejectReturnRequest`.

### Supabase — Returns Hub (ops view, `app/hooks/operations/useReturnsHubData.ts`)
- `Supabase RPC: get_returns_hub_metrics()` — `useReturnsHubData`. Returns the metric grid for the ops Returns Hub.

### Supabase — Client Portal (`app/hooks/fulfillment/returns/`)
- `Supabase: return_orders.select` filtered by `client_id`, `creation_date`, `status` — `useClientPortalMetrics`. Aggregates counts per status bucket (total / awaiting / in-progress / confirmed / dispatched). Issues 5 parallel `count: "exact", head: true` calls.
- `Supabase: return_orders.select` with `range()` + `or(...ilike)` + status `in()` — `useClientReturnOrders.buildOrdersQuery`. Paginated returns list (page size from `RETURN_ORDERS_PAGE_SIZE`).
- `Supabase: return_orders.select(ORDER_DETAIL_COLUMNS).eq("quiqup_order_id")` — `useReturnOrderDetail`. Single return order detail. Non-admins also filter by `client_id`. PGRST116 (no rows) is mapped to a "not found / no access" error.
- `Supabase: skus.select(SKU_DETAIL_COLUMNS).eq("return_order_id")` — `useReturnOrderDetail`. SKUs for the return.
- `Supabase: units.select(UNIT_DETAIL_COLUMNS).eq("return_order_id")` — `useReturnOrderDetail`. Unit-level detail.
- `Supabase: units.select("return_order_id").in("return_order_id", orderIds).eq("qa_qc_status", "fail")` — `useFailedUnitCounts`. Bulk count of failed units, no N+1.

---

## 14. Finance (Invoicer + Stripe)

### Invoicer (Zoho) — `app/hooks/finance/use-finance.tsx`
- `GET /zoho/invoices` (line 13, `useInvoicerApi`) — `useGetInvoices`. List invoices for the finance page.
- `GET /zoho/invoice/{invoiceId}/pdf` (line 30) — `useDownloadInvoice`. Streams the invoice PDF.
- `GET /zoho/credit-notes` (line 69) — `useGetCreditNotes`.
- `GET /zoho/creditnote/{creditNoteId}/pdf` (line 86) — `useDownloadCreditNote`.

### Bank details (platform)
- `PUT /accounts` (line 127, `usePlatformApi`) — `useUpdateBankDetails`. Bank-info subset; same endpoint as account update but scoped to finance section.

### Stripe payments — `app/hooks/finance/stripe/use-stripe.tsx`
All `usePlatformApi`:
- `GET /quiqdash/payments/setup-intent` — `useSetupIntent`. Stripe SetupIntent client_secret for adding a card.
- `GET /quiqdash/payments/customer-session` — `useCustomerSession`. Stripe Customer Session ephemeral key.
- `GET /quiqdash/payments/users/me` — `useStripeData`. Whether the user has a payment method on file (drives the "Add card" vs "Update card" toast labels in RFC flows).
- `GET /quiqdash/payments/payment-methods` — `usePaymentMethods`.
- `GET /quiqdash/payments/payment-methods/{paymentMethodID}` — `usePaymentMethod`.
- `DELETE /quiqdash/payments/payment-methods/{paymentMethodID}` — `useDeletePaymentMethod`.

### COD confirmation (external link)
- `app/routes/finance/credit-notes/columns.tsx:95` constructs `${VITE_INVOICER_BASE_URL}/credit-notes/confirm-cod/{creditnoteNumber}` as an outbound link. No fetch from the client.

---

## 15. Notifications

### `GET /quiqdash/notifications`
- **Triggered by:** `app/hooks/notification/use-notification.tsx:12` → `useNotification`
- **Purpose:** Loads the in-app notifications list and writes it to `useNotificationStore`.
- **Source:** REST (platform).

---

## 16. Analytics & Reports (Metabase)

### `GET /quiqdash/reports/token/{id}?userKey=` (or `/quiqdash/reports/token-unsafe/{id}` for Alshayaa role)
- **Triggered by:** `app/hooks/analytics/use-analytics.tsx:16` → `useGetReportsToken`
- **Purpose:** Mints a signed Metabase token to embed the dashboard `id` (`VITE_METABASE_*_DASHBOARD_ID`). Role-aware: `reports_beta` (Alshayaa) gets the "unsafe" path that doesn't append a userKey; others get a `userKey` of `id` (prod) or `client_id` (non-prod).
- **Source:** REST (platform).

### Metabase iframe
- `app/routes/analytics/page.tsx:18` — `metabaseUrl = VITE_METABASE_URL || https://metabase.dev.quiq.ly`. The signed JWT from above is injected into the iframe URL.

---

## 17. AI Chat (Mastra Agent)

### `POST {VITE_MASTRA_URL}/chat/operationsAgent` (SSE stream)
- **Triggered by:** `app/components/chat/chat-panel.tsx:23` → AI SDK `useChat({ api: AGENT_STREAM_ENDPOINT })`
- **Purpose:** Streams the operations agent's response — tool calls (order lookups, status updates), text deltas, step starts. Tool effects are handled by `app/hooks/chat/use-agent-tool-effects.ts` which can trigger refetches on the surrounding page.
- **Auth:** Clerk JWT via `mastraFetch` wrapper. 401 → retry once with fresh token → throw `AuthenticationError`.
- **Source:** REST (Mastra service).

### `GET {VITE_MASTRA_URL}/api/memory/threads/{threadId}`
- **Triggered by:** `app/hooks/chat/use-thread-hydration.ts:29`
- **Purpose:** Hydrates a saved conversation thread when the user reopens the chat panel.
- **Source:** REST (Mastra).

Supporting hooks: `use-auth-refresh.ts`, `use-pending-message-dispatch.ts`, `use-streaming-timeout.ts` (manage token refresh, queued send-while-loading, and inactivity timeouts respectively — no additional endpoints).

---

## 18. Cross-cutting notes

- Most mutation hooks invalidate broad query keys (e.g. `["orders"]`, `["get", "/account"]`) to keep lists fresh after writes. The Returns Hub Supabase hooks use their own keys (`returns-hub-metrics`, `client-portal-metrics`, …).
- Hooks that bypass `openapi-react-query` (raw `fetch` against `apiClient.baseUrl/.token`) are always either binary downloads (PDF/CSV blobs via `FileSaver.saveAs`) or multipart uploads — endpoints that openapi-fetch can't model cleanly.
- The Bulk Change State flow is the largest single chunk of state-machine API surface: 13 typed proxies under `/quiqdash/orders/batch/...` plus 4 reason-lookup endpoints, all dispatched from one hook.
- Endpoints commented `as any` (Order History/Update, Cancellation Reasons, Shipment carrier update, Zoho invoices/credit-notes) are not yet in the generated OpenAPI types — regenerating `app/lib/api/v1` via `bun gen:types` should remove those casts once BE publishes the schemas.
---

## §19 Appendix — Request / Response schema reference

Inline payload + response shapes for every endpoint described above. The Platform API portion (§19 A) is **auto-extracted** from `app/lib/api/openapi.json` and rendered as compact TypeScript-ish types — regenerate with `python3 scripts/extract_schemas.py` whenever `bun gen:types` updates the spec. Everything else is **best-effort from the client code** because the upstream service either has no public OpenAPI spec, returns binary blobs, or uses a streaming protocol; each block is labelled accordingly.

Notation:
- `field: T` is required, `field?: T` is optional.
- `T[]` is an array; `Record<K, V>` is a dictionary.
- `"a" | "b"` is a string-literal union (enum).
- `object` means "shape not declared in OpenAPI" — usually a passthrough body the backend treats as untyped.
- `unknown` means the spec defined the field but with no constraints.

---

## §19 A — Platform & Internal API (typed, auto-extracted)

### §1 — Auth, Account, Permissions, Signup

#### `GET /account`

**Response 200** (`application/json`):
```ts
{
   Cross_Border_Terms_Signed__c: string;
   Fulfilment_Terms_Signed__c?: string;
   allow_carrier_cod: boolean;
   anchanto_customer_code: string;
   anchanto_warehouse_code: string;
   automatic_service_interruption: boolean;
   bank_account_name: string;
   bank_name: string;
   billing_model: string;
   carrier_account: string;
   client_type: string;
   connector_type: string;
   customer_segmentation_id?: string;
   description: string;
   dhl_incoterm: string;
   does_fulfillment: boolean;
   ecommerce_delivery_options: string;
   em_post_vertical: string;
   email: string;
   email_addresses_for_invoicing: string;
   export_client: boolean;
   external_id: string;
   first_name: string;
   iban_number: string;
   id: string;
   last_modified_date: string /* date-time */;
   last_name: string;
   mirsal_code?: string;
   mobile: string;
   must_have_bank_card: boolean;
   name: string;
   next_day_cut_off_time: string;
   next_day_other_emirates_cut_off_time: string;
   ops_poc_email: string;
   qa_qc_enabled: boolean;
   region: string;
   returns_procedure: string;
   sales_ff_setup_completed: boolean;
   same_day_cut_off_time: string;
   same_day_other_emirates_cut_off_time: string;
   service_offering: string;
   ships_dangerous_goods: boolean;
   signed_terms: string;
   status_if_active: string;
   type: string;
   use_platform_pricing_for_international: boolean;
   website: string;
   wms_ff_setup_completed: boolean;
   x4hr_cut_off_time: string 
}
```

#### `GET /me`

**Header params:**
- `x-api-version`: `number` *(required)*

**Response 200** (`application/json`):
```ts
{
   admin: boolean;
   core_api_user_id: number;
   courier: boolean;
   csr: boolean;
   display_name: string;
   email: string;
   firstname: string;
   id: string;
   lastname: string;
   region_code: string;
   roles: string[];
   salesforce_id: string 
}
```

#### `GET /permissions`

**Header params:**
- `x-api-version`: `number` *(required)*

**Response 200** (`application/json`):
```ts
{
   permissions: string[] 
}
```

#### `GET /accounts/{id}/capabilities`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   carriers: {
     carrier_name: string;
     features: object;
     incoterms: object[] 
  }[] 
}
```

#### `GET /accounts/{id}`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   Cross_Border_Terms_Signed__c: string;
   Fulfilment_Terms_Signed__c?: string;
   allow_carrier_cod: boolean;
   anchanto_customer_code: string;
   anchanto_warehouse_code: string;
   automatic_service_interruption: boolean;
   bank_account_name: string;
   bank_name: string;
   billing_model: string;
   carrier_account: string;
   client_type: string;
   connector_type: string;
   customer_segmentation_id?: string;
   description: string;
   dhl_incoterm: string;
   does_fulfillment: boolean;
   ecommerce_delivery_options: string;
   em_post_vertical: string;
   email: string;
   email_addresses_for_invoicing: string;
   export_client: boolean;
   external_id: string;
   first_name: string;
   iban_number: string;
   id: string;
   last_modified_date: string /* date-time */;
   last_name: string;
   mirsal_code?: string;
   mobile: string;
   must_have_bank_card: boolean;
   name: string;
   next_day_cut_off_time: string;
   next_day_other_emirates_cut_off_time: string;
   ops_poc_email: string;
   qa_qc_enabled: boolean;
   region: string;
   returns_procedure: string;
   sales_ff_setup_completed: boolean;
   same_day_cut_off_time: string;
   same_day_other_emirates_cut_off_time: string;
   service_offering: string;
   ships_dangerous_goods: boolean;
   signed_terms: string;
   status_if_active: string;
   type: string;
   use_platform_pricing_for_international: boolean;
   website: string;
   wms_ff_setup_completed: boolean;
   x4hr_cut_off_time: string 
}
```

#### `PUT /accounts`

**Request body** (`application/json`):
```ts
{
   bank_account_name: string;
   bank_name: string;
   carrier_account: string;
   cross_border_terms_signed: string;
   customer_segmentation_id?: string;
   dhl_incoterm: string;
   export_client: boolean;
   fulfilment_terms_signed?: string;
   iban_number: string;
   mirsal_code?: string;
   qa_qc_enabled?: boolean;
   use_platform_pricing_for_international: boolean 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `GET /quiqup/service-kinds`

**Response 200** (`application/json`):
```ts
{
   kinds: {
     code: string;
     title: string 
  }[] 
}
```

#### `GET /quiqdash/init`

**Response 200** (`application/json`):
```ts
{
   account_description: string;
   account_id: string;
   account_name: string;
   account_region: string;
   account_type: string;
   account_website: string;
   admin: boolean;
   connector_type: string;
   core_api_user_id: number;
   courier: boolean;
   csr: boolean;
   default_job_kind: string;
   default_pickup_details: {
     autofill: boolean;
     contact_name: string;
     contact_phone: string;
     instructions: string;
     location_id: number 
  };
   display_name: string;
   ecommerce_delivery_options: string;
   email: string;
   firstname: string;
   has_overdue_invoices: boolean;
   id: string;
   is_order_submission_blocked: boolean;
   lastname: string;
   linehaul_method: string;
   location: {
     address1: string;
     address2: string;
     address_book_id: number;
     apartment_number: string;
     building_name: string;
     contact_name: string;
     coords: number[];
     county: string;
     gid: string;
     id: number;
     location_type: string;
     name: string;
     notes: string;
     partial_match: boolean;
     phone: string;
     postcode: string;
     town: string;
     valid: boolean;
     what3words: string 
  };
   multi_drop_allowed: boolean;
   multi_pick_allowed: boolean;
   next_day_cut_off_time: string;
   next_day_other_emirates_cut_off_time: string;
   notifications_enabled: boolean;
   notifications_minutes: number;
   partner_4hr_cut_off_time: string;
   payment_modes_available: boolean;
   pooling_allowed: boolean;
   pricing: {
     active_from: string;
     additional_box_charge: number;
     aramex_epg: number;
     aramex_fuel_surcharge: number;
     aramex_markup: number;
     billing_period: string;
     card_charge_percentage: string;
     cash_charge_percentage: string;
     charge_for_rto: boolean;
     dhl_epg: number;
     dhl_fuel_surcharge: number;
     dhl_markup: number;
     does_batch_management: boolean;
     dry: boolean;
     extra_kg_fee: string;
     extra_km_fee: string;
     fixed_card_fee: string;
     fixed_cash_fee: string;
     grace_period: string;
     handling_out_per_piece: number;
     handling_out_per_sealed_box_per_cbm: number;
     handling_out_surcharge_for_batch_managem: number;
     id: string;
     inbound_by_cbm: boolean;
     inbound_surcharge_for_batch_management: number;
     international_order_delivery_fee: number;
     labeling_per_item: number;
     manpower_charge_per_hour: number;
     max_kg_per_parcel: string;
     min_delivery_charge: number;
     msds_approval_per_msds: number;
     number_of_free_pieces_per_order: number;
     per_additional_item_fee: string;
     pick_pack_additional_items_surcharge_f: number;
     pick_pack_per_item: number;
     pick_pack_surcharge_for_batch_manageme: number;
     price_per_box_b2: number;
     pricings: object[];
     receiving_stock_per_sealed_box_per_cbm: number;
     remote_area_fee: string;
     small_carton: number;
     special_packaging_price: number;
     truck_load_collection_dubai: number;
     truck_load_collection_outside_dubai: number;
     type: string 
  };
   region: {
     center_lat: string;
     center_lon: string;
     code: string;
     currency_symbol: string;
     geocoding_source: string;
     name: string;
     phone_country_code: string;
     support_phone_number: string 
  };
   region_code: string;
   roles: string[];
   salesforce_id: string;
   same_day_cut_off_time: string;
   same_day_other_emirates_cut_off_time: string 
}
```

#### `POST /featureflags/decide-bulk`

**Request body** (`application/json`):
```ts
{
   Features: string[];
   Identifier: string 
}
```
**Response 200** (`application/json`):
```ts
{
   Flags: Record<string, boolean> 
}
```

#### `GET /api/accounts/{accountID}/return-settings`

**Path params:**
- `accountID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   account_id: string;
   approval_rule: string;
   created_at: string /* date-time */;
   enabled: boolean;
   id: string;
   notification_email: string;
   return_window_days: number;
   threshold_value_aed: object;
   updated_at: string /* date-time */ 
}
```

#### `PUT /api/accounts/{accountID}/return-settings`

**Path params:**
- `accountID`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   approval_rule: string;
   enabled: boolean;
   notification_email: string;
   return_window_days: number;
   threshold_value_aed: number 
}
```
**Response 200** (`application/json`):
```ts
{
   account_id: string;
   approval_rule: string;
   created_at: string /* date-time */;
   enabled: boolean;
   id: string;
   notification_email: string;
   return_window_days: number;
   threshold_value_aed: object;
   updated_at: string /* date-time */ 
}
```

#### `POST /partner/register`

**Request body** (`application/json`):
```ts
{
   account_name: string;
   email: string;
   full_name: string;
   orders_per_month: string;
   other_vertical: string;
   password: string;
   phone: string;
   service_type?: string;
   signed_terms: string;
   utm_campaign: string;
   utm_content: string;
   utm_medium: string;
   utm_source: string;
   utm_term: string;
   vertical: string 
}
```
**Response 200** (`application/json`):
```ts
{
   id: string 
}
```

#### `POST /account/team`

**Request body** (`application/json`):
```ts
{
   name: string 
}
```
**Response 200** (`application/json`):
```ts
{
   org_id: string 
}
```

### §2 — Integrations (Shopify / WooCommerce / generic)

#### `GET /integrations/connections`

**Response 200** (`application/json`):
```ts
{
   connections: {
     created_at: string /* date-time */;
     id: string;
     is_fulfillment: boolean;
     shop_name: string;
     site_url: string;
     source: string;
     token: string;
     updated_at: string /* date-time */;
     user_id: string 
  }[] 
}
```

#### `DELETE /{source}/delete/{shopName}`

_(not in openapi.json)_

#### `GET /integrations/order-reasons`

**Query params:**
- `sales_channel`: `string` *(required)*
- `status`: `string` *(required)*
- `start_date`: `string /* date-time */` *(required)*
- `end_date`: `string /* date-time */` *(required)*
- `user_id`: `string` *(required)*
- `limit`: `number` *(required)*
- `offset`: `number` *(required)*

**Response 200** (`application/json`):
```ts
{
   limit: number;
   offset: number;
   reasons: {
     attempts: number;
     created_at: string /* date-time */;
     details: string;
     fulfillment_order_id: string;
     id: number;
     last_attempt_at: string /* date-time */;
     location: string;
     order_id: string;
     order_number: string;
     reason: string;
     sales_channel: string;
     shipping_method: string;
     shop_name: string;
     site_url: string;
     status: string;
     submitted_at: string /* date-time */;
     updated_at: string /* date-time */;
     user_id: string 
  }[];
   total: number 
}
```

#### `POST /integrations/repair-orders`

**Request body** (`application/json`):
```ts
{
   end_date: string /* date-time */;
   ids: string[];
   order_name: string;
   shop_name: string;
   site_url: string;
   source: string;
   start_date: string /* date-time */;
   user_id: string 
}
```
**Response 200** (`application/json`):
```ts
{
   errors: string[];
   message: string;
   orders_created: number;
   orders_processed: number 
}
```

#### `GET /order/{orderUUID}`

**Path params:**
- `orderUUID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   billing_address: {
     address1: string;
     address2: string;
     city: string;
     company: string;
     coordinate: object;
     country: string;
     country_code: string;
     created_at: string /* date-time */;
     currency: string;
     email: string;
     first_name: string;
     id: number;
     last_name: string;
     metadata: object;
     name: string;
     note: string;
     phone: string;
     postcode: string;
     province: string;
     province_code: string;
     state: string;
     updated_at: string /* date-time */;
     zip: string 
  };
   billing_identifier: string;
   cancel_reason: string;
   cancelled_at: string /* date-time */;
   cart_hash: string;
   cart_token: string;
   checkout_token: string;
   client_details: {
     accept_language: string;
     browser_height: number;
     browser_ip: string;
     browser_width: number;
     session_hash: string;
     user_agent: string 
  };
   client_order_id: number;
   closed_at: string /* date-time */;
   company: {
     id: number;
     location_id: number 
  };
   created_at: string /* date-time */;
   created_via: string;
   currency: string;
   customer_id: number;
   customer_note: string;
   date_completed: string /* date-time */;
   date_created_gmt: string /* date-time */;
   date_modified: string /* date-time */;
   date_paid: string /* date-time */;
   date_paid_gmt: string /* date-time */;
   discount_tax: object;
   discount_total: object;
   errors: Array<Record<string, string>>;
   external_order_id: string;
   gift_details: {
     gift_type: string;
     message: string;
     packaging: string;
     receiver_name: string;
     sender_name: string 
  };
   id: string;
   initial_order_id: string;
   is_fulfillment: boolean;
   is_return: boolean;
   last_author_id: string;
   last_author_update_at: string /* date-time */;
   last_author_updated_fields: string[];
   line_items: {
     dimensions: object;
     id: number;
     meta_data: object[];
     name: string;
     parcel_barcode: string;
     price: object;
     product_id: number;
     quantity: number;
     sku: string;
     status: string;
     subtotal: object;
     subtotal_tax: object;
     taxes: object[];
     total: object;
     total_tax: object;
     variation_id: number;
     weight_in_grams: number 
  }[];
   meta_data: {
     id: number;
     key: string;
     value: string 
  }[];
   needs_carrier_booking: boolean;
   needs_manual_confirmation: boolean;
   number: number;
   order_key: string;
   order_status_url: {
     order_status_url: string 
  };
   origin_address: {
     address1: string;
     address2: string;
     city: string;
     company: string;
     coordinate: object;
     country: string;
     country_code: string;
     created_at: string /* date-time */;
     currency: string;
     email: string;
     first_name: string;
     id: number;
     last_name: string;
     metadata: object;
     name: string;
     note: string;
     phone: string;
     postcode: string;
     province: string;
     province_code: string;
     state: string;
     updated_at: string /* date-time */;
     zip: string 
  };
   parent_id: number;
   partner_order_id: string;
   payment_amount: object;
   payment_method: string;
   payment_method_title: string;
   payment_mode: string;
   picking_order_created: boolean;
   picking_order_triggered_by: string;
   prices_include_tax: boolean;
   products: {
     barcode: string;
     country_of_origin: string;
     dangerous_goods: boolean;
     description: string;
     dimension_unit: string;
     height: object;
     hs_code: string;
     length: object;
     name: string;
     quantity: number;
     selling_price: object;
     sku: string;
     weight: object;
     width: object 
  }[];
   refunds: {
     created_at: string /* date-time */;
     id: number;
     note: string;
     order_adjustments: object[];
     order_id: number;
     processed_at: string /* date-time */;
     refund_line_items: object[];
     transactions: object[];
     user_id: number 
  }[];
   service_kind: string;
   shipping: {
     address1: string;
     address2: string;
     city: string;
     company: string;
     coordinate: object;
     country: string;
     country_code: string;
     created_at: string /* date-time */;
     currency: string;
     email: string;
     first_name: string;
     id: number;
     last_name: string;
     metadata: object;
     name: string;
     note: string;
     phone: string;
     postcode: string;
     province: string;
     province_code: string;
     state: string;
     updated_at: string /* date-time */;
     zip: string 
  };
   shipping_lines: {
     id: number;
     meta_data: object[];
     method_id: number;
     method_title: string;
     taxes: object[];
     total: object;
     total_tax: object 
  }[];
   shipping_method: string;
   shipping_method_kind: string;
   shipping_profile_id: string;
   shipping_tax: object;
   shipping_total: object;
   shop_name: string;
   site_url: string;
   source: string;
   status: string;
   status_reason: string;
   subtotal: object;
   tax_lines: {
     compound: boolean;
     id: number;
     label: string;
     meta_data: object[];
     price: object;
     rate: object;
     rate_code: string;
     rate_id: number;
     shipping_tax_total: string;
     subtotal: object;
     tax_total: string;
     title: string 
  }[];
   total: object;
   total_tax: object;
   tracking_token: string;
   transaction_id: string;
   updated_at: string /* date-time */;
   user_id: string;
   uuid: string;
   version: string;
   wms_delay_minutes: number 
}
```

#### `POST /orders/confirm-ff-export`

**Request body** (`application/json`):
```ts
{
   order_uuid: string 
}
```
**Response 200** (`application/json`):
```ts
{
   result: string 
}
```

#### `GET /shopify/config/{shopName}`

**Path params:**
- `shopName`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   auto_mark_as_rfc: boolean;
   delivery_methods: {
     quiqup_name: string;
     shipping_method_id: string;
     shipping_profile_id: string;
     shopify_name: string 
  }[];
   fulfillment_state: string;
   is_fulfillment: boolean;
   is_manual_international_order_confirmed: boolean;
   locations: {
     quiqup_location: string;
     shopify_location: string 
  }[];
   shop_name: string;
   user_id: string;
   wms_delay_minutes: number 
}
```

#### `GET /shopify/delivery-methods`

**Query params:**
- `shop_name`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   delivery_methods: {
     code: string;
     shipping_method_id: string;
     title: string 
  }[] 
}
```

#### `GET /shopify/locations`

**Query params:**
- `shop_name`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   locations: {
     code: string;
     shipping_method_id: string;
     title: string 
  }[] 
}
```

#### `PUT /shopify/config`

**Request body** (`application/json`):
```ts
{
   auto_mark_as_rfc: boolean;
   delivery_methods: {
     quiqup_name: string;
     shipping_method_id: string;
     shipping_profile_id: string;
     shopify_name: string 
  }[];
   fulfillment_state: string;
   is_manual_international_order_confirmed: boolean;
   locations: {
     quiqup_location: string;
     shopify_location: string 
  }[];
   shop_name: string;
   wms_delay_minutes: number 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string;
   resolved_inventory_item_id?: number 
}
```

#### `PUT /shopify/connection`

**Request body** (`application/json`):
```ts
{
   code: string;
   created_at: string /* date-time */;
   is_fulfillment: boolean;
   shop_name: string;
   token: string;
   updated_at: string /* date-time */;
   user_id: string 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string;
   resolved_inventory_item_id?: number 
}
```

#### `POST /shopify/callback`

**Query params:**
- `shop_name`: `string` *(required)*
- `code`: `string` *(required)*
- `is_fulfillment`: `boolean` *(required)*

**Response 200** (`application/json`):
```ts
{
   success_url: string 
}
```

#### `GET /woocommerce/connections`

**Response 200** (`application/json`):
```ts
{
   connections: {
     created_at: string /* date-time */;
     is_fulfillment: boolean;
     order_created_webhook_id: number;
     order_created_webhook_secret: string;
     order_updated_webhook_id: number;
     order_updated_webhook_secret: string;
     shop_name: string;
     site_url: string;
     token: string;
     updated_at: string /* date-time */;
     user_id: string;
     webhooks: object 
  }[] 
}
```

#### `GET /woocommerce/config/{siteName}`

**Path params:**
- `siteName`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   auto_mark_as_rfc: boolean;
   country_filter: string[];
   created_at: string /* date-time */;
   delivery_method: {
     quiqup_name: string;
     shipping_profile_id: string;
     woocommerce: models.WooCommerceDeliveryMethodConfig 
  }[];
   initial_order_state: string;
   initial_order_states: string[];
   is_manual_international_order_confirmed: boolean;
   location: string;
   site_url: string;
   states: {
     quiqup_state: string;
     woocommerce_state: string 
  }[];
   sync_products: boolean;
   tracking_link: string;
   updated_at: string /* date-time */;
   user_id: string;
   wms_delay_minutes: number 
}
```

#### `GET /woocommerce/states`

**Response 200** (`application/json`):
```ts
{
   states: string[] 
}
```

#### `GET /woocommerce/shipping-lines`

**Query params:**
- `site_url`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   shipping_methods: {
     enabled: boolean;
     id: number;
     instance_id: number;
     method_description: string;
     method_id: string;
     method_title: string;
     order: number;
     settings: object;
     title: string;
     zone_id: number;
     zone_name: string 
  }[] 
}
```

#### `POST /woocommerce/connection`

**Request body** (`application/json`):
```ts
{
   is_fulfillment: boolean;
   shop_name: string;
   site_url: string;
   token: string 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `PUT /woocommerce/settings/config/upsert`

**Request body** (`application/json`):
```ts
{
   auto_mark_as_rfc: boolean;
   country_filter: string[];
   delivery_method: {
     quiqup_name: string;
     shipping_profile_id: string;
     woocommerce: models.WooCommerceDeliveryMethodConfig 
  }[];
   initial_order_state: string;
   initial_order_states: string[];
   is_manual_international_order_confirmed: boolean;
   location: string;
   site_url: string;
   states: {
     quiqup_state: string;
     woocommerce_state: string 
  }[];
   sync_products: boolean;
   tracking_link: string;
   wms_delay_minutes: number 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `GET /quiqup/orders/states`

**Response 200** (`application/json`):
```ts
{
   states: {
     code: string;
     description: string 
  }[] 
}
```

### §3 — Addresses & geographic lookups

#### `GET /accounts/{id}/addresses`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   addresses: {
     account: string;
     address_codes: object[];
     address_line1: string;
     address_line2: string;
     auto_fill: boolean;
     coordinates: string;
     country: string;
     created_by_id: string;
     created_date: string /* date-time */;
     currency_iso_code: string;
     id: string;
     instructions_notes: string;
     is_deleted: boolean;
     last_modified_by_id: string;
     last_modified_date: string /* date-time */;
     last_referenced_date: string /* date-time */;
     last_viewed_date: string /* date-time */;
     latitude: number;
     linehaul_method: string;
     long_location_name: string;
     longitude: number;
     name: string;
     next_day_cut_off_time: string;
     next_day_other_emirates_cut_off_time: string;
     phone_number: string;
     pickup_zone: string;
     region: string;
     same_day_cut_off_time: string;
     same_day_other_emirates_cut_off_time: string;
     system_modstamp: string /* date-time */;
     town: string;
     x4hr_cut_off_time: string 
  }[] 
}
```

#### `POST /partner/addresses`

**Request body** (`application/json`):
```ts
{
   address_codes?: {
     type: string;
     value: string 
  }[];
   address_line1: string;
   address_line2?: string;
   auto_fill: boolean;
   coordinates?: {
     latitude: number;
     longitude: number 
  };
   country?: string;
   instructions_notes?: string;
   long_location_name?: string;
   name: string;
   phone_number: string;
   pickup_zone: string;
   region: string 
}
```
**Response 200** (`application/json`):
```ts
{
   address_codes: {
     type: string;
     value: string 
  }[];
   address_line1: string;
   address_line2: string;
   auto_fill: boolean;
   coordinates: {
     latitude: number;
     longitude: number 
  };
   country: string;
   external_id: string;
   id: string;
   instructions_notes: string;
   linehaul_method: string;
   long_location_name: string;
   name: string;
   next_day_cut_off_time: string;
   next_day_other_emirates_cut_off_time: string;
   phone_number: string;
   pickup_zone: string;
   region: string;
   same_day_cut_off_time: string;
   same_day_other_emirates_cut_off_time: string;
   town: string;
   x4hr_cut_off_time: string 
}
```

#### `PATCH /partner/addresses/{id}`

**Path params:**
- `id`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   address_codes?: {
     type: string;
     value: string 
  }[];
   address_line1?: string;
   address_line2?: string;
   coordinates?: {
     latitude: number;
     longitude: number 
  };
   country?: string;
   instructions_notes?: string;
   long_location_name?: string;
   name?: string;
   phone_number?: string;
   pickup_zone?: string;
   region?: string 
}
```
**Response 200** (`application/json`):
```ts
{
   address_codes: {
     type: string;
     value: string 
  }[];
   address_line1: string;
   address_line2: string;
   auto_fill: boolean;
   coordinates: {
     latitude: number;
     longitude: number 
  };
   country: string;
   external_id: string;
   id: string;
   instructions_notes: string;
   linehaul_method: string;
   long_location_name: string;
   name: string;
   next_day_cut_off_time: string;
   next_day_other_emirates_cut_off_time: string;
   phone_number: string;
   pickup_zone: string;
   region: string;
   same_day_cut_off_time: string;
   same_day_other_emirates_cut_off_time: string;
   town: string;
   x4hr_cut_off_time: string 
}
```

#### `GET /countries`

**Response 200** (`application/json`):
```ts
{
   countries: {
     id: number;
     iso2: string;
     name: string;
     phone_code: string 
  }[] 
}
```

#### `GET /countries/{countryIso2}/states`

**Path params:**
- `countryIso2`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   states: {
     id: number;
     name: string 
  }[] 
}
```

#### `GET /countries/{countryNameOrIso2}/cities`

**Path params:**
- `countryNameOrIso2`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   cities: {
     id: number;
     name: string 
  }[] 
}
```

#### `GET /countries/{countryIso2}/states/{stateNameOrCode}/cities`

**Path params:**
- `countryIso2`: `string` *(required)*
- `stateNameOrCode`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   cities: {
     id: number;
     name: string 
  }[] 
}
```

### §4 — Orders listing & filter lookups

#### `GET /quiqdash/orders/find_by_id_or_barcode`

**Query params:**
- `value`: `string` *(required)*
- `intention`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   error: string;
   found_by: string;
   order: {
     allowed_payment_types: string[];
     billing_identifier: string;
     brand_name: string;
     collection_attempts: number;
     collection_time: object;
     created_at: string;
     delivery_attempts: number;
     delivery_failure_reason: string;
     delivery_time: object;
     destination: object;
     display_items_info: boolean;
     forward_order_id: number;
     forward_partner_order_id: string;
     id: number;
     item_quantity_count: number;
     items: object[];
     kind: string;
     last_event: object;
     on_hold_reason: string;
     origin: object;
     partner_order_id: string;
     payment_amount: string;
     payment_mode: string;
     print_label: boolean;
     products: object[];
     reason: string;
     references: object[];
     region_name: string;
     required_documents: string[];
     return_order_id: number;
     return_partner_order_id: string;
     return_to_origin_reason: string;
     scheduled_for: string;
     service_kind: string;
     sku_info: string;
     state: string;
     state_updated_at: string;
     submitted_at: string;
     tracking_url: string;
     uuid: string;
     weight_kg: number 
  } 
}
```

#### `GET /quiqdash/depots`

**Query params:**
- `region`: `string` *(required)*
- `mainDepot`: `boolean` *(required)*

**Response 200** (`application/json`):
```ts
{
   depots: {
     address1: string;
     address2: string;
     apartmentNumber: string;
     contactName: string;
     coordinates: object;
     coords: number[];
     country: string;
     emirate: string;
     id: string;
     mainDepot: string;
     micro: boolean;
     name: string;
     phone: string;
     region: string 
  }[] 
}
```

#### `GET /quiqdash/missions`

**Query params:**
- `value`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   results: string[] 
}
```

#### `GET /quiqdash/orders/states/on_hold_reasons`

**Query params:**
- `service_kind`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   reasons: {
     id: number;
     name: string;
     tooltip: string 
  }[] 
}
```

#### `GET /quiqdash/orders/states/return_to_origin_reasons`

**Response 200** (`application/json`):
```ts
{
   reasons: {
     id: number;
     name: string;
     tooltip: string 
  }[] 
}
```

#### `GET /quiqdash/orders/cancellation-reasons`

**Response 200** (`application/json`):
```ts
{
   reasons: {
     id: number;
     name: string;
     tooltip: string 
  }[] 
}
```

#### `GET /quiqdash/courier/delivery_failure_reasons`

**Query params:**
- `delivery_type`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   reasons: {
     id: number;
     name: string;
     uid: string 
  }[] 
}
```

### §5 — Order details (typed mutations)

#### `PATCH /api/fulfilment/orders/{id}`

**Path params:**
- `id`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   billing_address: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   carrier?: string;
   incoterm?: string;
   origin_address: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   payment_amount: number;
   payment_mode: string;
   products: {
     country_of_origin?: string;
     dimensions?: object;
     hs_code?: string;
     quantity: number;
     selling_price?: number;
     sku: string;
     weight?: number;
     weight_unit?: string 
  }[];
   service_kind: string;
   shipping_address: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   status: string 
}
```
**Response 200** (`application/json`):
```ts
{
   billing_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   carrier?: string;
   created_at?: string /* date-time */;
   currency?: string;
   delivery_options?: string[];
   errors?: Array<Record<string, string>>;
   id?: string;
   incoterm?: string;
   initial_order_id?: string;
   is_return?: boolean;
   notes?: string;
   origin_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   parcels?: {
     dimensions?: object;
     id?: string;
     name?: string;
     notes?: string;
     parcel_barcode?: string;
     quantity?: number;
     weight?: number 
  }[];
   partner_order_id?: string;
   payment_amount?: number;
   payment_mode?: string;
   picking_order_created?: boolean;
   products?: {
     country_of_origin?: string;
     description?: string;
     dimensions?: object;
     hs_code?: string;
     name?: string;
     quantity?: number;
     selling_price?: number;
     sku?: string;
     weight?: number;
     weight_unit?: string 
  }[];
   service_kind?: string;
   shipping_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   status?: string;
   status_reason?: string;
   tracking_url?: string;
   tracking_url_advance?: string;
   updated_at?: string /* date-time */;
   uuid?: string 
}
```

#### `POST /quiqdash/order-charge`

**Request body** (`application/json`):
```ts
{
   account_id: number;
   area: string;
   service_kind: string 
}
```
**Response 200** (`application/json`):
```ts
{
   amount: string 
}
```

#### `PATCH /quiqdash/orders/{orderId}/weight`

**Path params:**
- `orderId`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   items: {
     id: string;
     name: string;
     parcel_barcode: string;
     parcel_barcode_generated_by: string;
     quantity: number;
     weight: string 
  }[];
   weight_kg: number 
}
```
**Response 200** (`application/json`):
```ts
{
   order_id: number 
}
```

### §6 — Order creation

#### `POST /quiqdash/orders`

**Response 200:** _no body_

#### `POST /internal/fulfilment/orders`

**Request body** (`application/json`):
```ts
{
   billing_address?: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   billing_identifier?: string;
   carrier?: string;
   currency?: string;
   delivery_options?: string[];
   incoterm?: string;
   initial_order_id?: string;
   is_return?: boolean;
   mark_as_ready_for_collection?: boolean;
   needs_manual_confirmation: boolean;
   notes?: string;
   origin_address: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   partner_order_id: string;
   payment_amount: number;
   payment_mode: string;
   products?: {
     quantity: number;
     sku: string 
  }[];
   registration_numbers?: {
     issuer_country_code: string;
     type_code: string;
     value: string 
  }[];
   service_kind: string;
   shipping_address: {
     address1: string;
     address2?: string;
     city: string;
     coordinate?: object;
     country?: string;
     country_code: string;
     email: string;
     first_name: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone: string;
     postcode?: string;
     state?: string 
  };
   source: string 
}
```
**Response 200** (`application/json`):
```ts
{
   billing_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   carrier?: string;
   created_at?: string /* date-time */;
   currency?: string;
   delivery_options?: string[];
   errors?: Array<Record<string, string>>;
   id?: string;
   incoterm?: string;
   initial_order_id?: string;
   is_return?: boolean;
   notes?: string;
   origin_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   parcels?: {
     dimensions?: object;
     id?: string;
     name?: string;
     notes?: string;
     parcel_barcode?: string;
     quantity?: number;
     weight?: number 
  }[];
   partner_order_id?: string;
   payment_amount?: number;
   payment_mode?: string;
   picking_order_created?: boolean;
   products?: {
     country_of_origin?: string;
     description?: string;
     dimensions?: object;
     hs_code?: string;
     name?: string;
     quantity?: number;
     selling_price?: number;
     sku?: string;
     weight?: number;
     weight_unit?: string 
  }[];
   service_kind?: string;
   shipping_address?: {
     address1?: string;
     address2?: string;
     city?: string;
     coordinate?: object;
     country?: string;
     country_code?: string;
     created_at?: string /* date-time */;
     email?: string;
     first_name?: string;
     ksa_national_address?: string;
     last_name?: string;
     name?: string;
     notes?: string;
     phone?: string;
     postcode?: string;
     state?: string;
     updated_at?: string /* date-time */ 
  };
   status?: string;
   status_reason?: string;
   tracking_url?: string;
   tracking_url_advance?: string;
   updated_at?: string /* date-time */;
   uuid?: string 
}
```

### §7 — Bulk status transitions

#### `PUT /quiqdash/orders/batch/set_ready_for_collection`

**Request body** (`application/json`):
```ts
{
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_collected`

**Request body** (`application/json`):
```ts
{
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_received_at_depot`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_at_depot`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_in_transit`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_scheduled`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_delivery_complete`

**Request body** (`application/json`):
```ts
{
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_on_hold`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   onHoldReason: string;
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_return_to_origin`

**Request body** (`application/json`):
```ts
{
   location: {
     address: string;
     coords: number[];
     name: string;
     region: string 
  };
   orderIds: string[];
   returnToOriginReason: string 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_returned_to_origin`

**Request body** (`application/json`):
```ts
{
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_cancelled`

**Request body** (`application/json`):
```ts
{
   orderIds: string[];
   reason: string 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/orders/batch/set_delivery_failed`

**Request body** (`application/json`):
```ts
{
   failureReason: string;
   failureReasonUid: string;
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/courier/orders/set_collection_failed`

**Request body** (`application/json`):
```ts
{
   failureReason: string;
   failureReasonUid: string;
   orderIds: string[] 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/missions/unpool/orders/{orderUUID}`

**Path params:**
- `orderUUID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

### §8 — Missions

#### `POST /quiqdash/missions`

**Request body** (`application/json`):
```ts
{
   depotId: string;
   orderIds: string[];
   type: string;
   zone: string 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

#### `PUT /quiqdash/missions/transfer/{missionID}`

**Path params:**
- `missionID`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   depotId: string;
   orderIds: string[];
   type: string;
   zone: string 
}
```
**Response 200** (`application/json`):
```ts
{
   body: object 
}
```

### §9 — Inbound (warehouse receiving)

#### `GET /api/fulfilment/slots/available`

**Query params:**
- `warehouse_code`: `string` *(required)*
- `start_time`: `string /* date-time */` *(required)*
- `end_time`: `string /* date-time */` *(required)*

**Response 200** (`application/json`):
```ts
{
   slots: {
     end_time: string /* date-time */;
     start_time: string /* date-time */ 
  }[] 
}
```

#### `POST /fulfillment/inbound/book`

**Request body** (`application/json`):
```ts
{
   attendees?: string[];
   client_id: string;
   courier_contact?: string;
   courier_name?: string;
   documents: {
     content_base64?: string;
     created_at?: string /* date-time */;
     document_type: string;
     file_name?: string;
     file_size?: number;
     file_url?: string;
     id?: string;
     inbound_id?: string;
     mime_type?: string;
     updated_at?: string /* date-time */ 
  }[];
   items: {
     barcode?: string;
     base_line_number?: number;
     batch_number?: string;
     created_at?: string /* date-time */;
     expiry_date?: string;
     id?: string;
     inbound_id?: string;
     manufacturing_date?: string;
     original_order_ids?: string[];
     parent_sku?: string;
     quantity: number;
     quarantine_quantity?: number;
     received_qty?: number;
     sku: string;
     unit_price?: string;
     unusable_quantity?: number;
     uom?: string;
     uom_units?: number;
     updated_at?: string /* date-time */;
     usable_quantity?: number 
  }[];
   partner_inbound_id?: string;
   pickup_address: {
     city: string;
     country: string;
     landmark: string;
     postal_code: string;
     state: string;
     street: string 
  };
   pickup_contact: {
     company: string;
     email: string;
     instructions: string;
     name: string;
     phone: string 
  };
   plate_number?: string;
   slot_end_at?: string /* date-time */;
   slot_start_at?: string /* date-time */;
   type?: string 
}
```
**Response 200** (`application/json`):
```ts
{
   already_existed: boolean;
   asn_id: string;
   inbound_id: string;
   status: string 
}
```

#### `GET /api/fulfilment/inbounds`

**Query params:**
- `limit`: `number`
- `page`: `number`
- `sort`: `string`
- `sort_desc`: `boolean`
- `state`: `string`
- `ids`: `string[]`
- `asn_id`: `string`
- `type`: `string`
- `client_id`: `string`

**Response 200** (`application/json`):
```ts
{
   inbounds: {
     asn_id?: string;
     attendees?: string[];
     client_id?: string;
     courier_contact?: string;
     courier_name?: string;
     created_at: string /* date-time */;
     documents?: object[];
     error_message?: string;
     id: string;
     items?: object[];
     partner_inbound_id?: string;
     pickup_address?: object;
     pickup_contact?: object;
     pickup_window?: string;
     plate_number?: string;
     requires_collection?: boolean;
     slot_end_at?: string /* date-time */;
     slot_start_at?: string /* date-time */;
     status: string;
     type: string;
     updated_at: string /* date-time */;
     warehouse_code: string 
  }[];
   pagination: {
     next?: object;
     next_url?: string;
     prev?: object;
     prev_url?: string;
     total: number 
  } 
}
```

#### `GET /api/fulfilment/inbound/{id}`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   inbound: {
     asn_id?: string;
     attendees?: string[];
     client_id?: string;
     courier_contact?: string;
     courier_name?: string;
     created_at: string /* date-time */;
     documents?: object[];
     error_message?: string;
     id: string;
     items?: object[];
     partner_inbound_id?: string;
     pickup_address?: object;
     pickup_contact?: object;
     pickup_window?: string;
     plate_number?: string;
     requires_collection?: boolean;
     slot_end_at?: string /* date-time */;
     slot_start_at?: string /* date-time */;
     status: string;
     type: string;
     updated_at: string /* date-time */;
     warehouse_code: string 
  } 
}
```

#### `GET /api/fulfilment/inbound/{id}/state-history`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   history: {
     changed_by?: string;
     created_at: string /* date-time */;
     id: string;
     inbound_id: string;
     new_status: string;
     old_status: string;
     reason?: string;
     source?: string;
     wms_status?: string 
  }[] 
}
```

#### `GET /accounts/{accountId}/facility`

**Path params:**
- `accountId`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   facility?: {
     address_details: string;
     contact_emails: string;
     created_by_id: string;
     created_date: string;
     currency_iso_code: string;
     gatepass_required: boolean;
     id: string;
     is_deleted: boolean;
     last_activity_date: string;
     last_modified_by_id: string;
     last_modified_date: string;
     name: string;
     owner_id: string;
     provider: string;
     scheduling_link: string;
     system_modstamp: string;
     warehouse_code: string;
     wms_provider: string 
  } 
}
```

#### `POST /api/fulfilment/inbounds/{id}/cancel`

**Path params:**
- `id`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   reason?: string 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `PATCH /fulfillment/inbounds/{id}`

**Path params:**
- `id`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   attendees?: string[];
   courier_contact?: string;
   courier_name?: string;
   documents?: {
     content_base64?: string;
     created_at?: string /* date-time */;
     document_type: string;
     file_name?: string;
     file_size?: number;
     file_url?: string;
     id?: string;
     inbound_id?: string;
     mime_type?: string;
     updated_at?: string /* date-time */ 
  }[];
   plate_number?: string;
   slot_end_at?: string /* date-time */;
   slot_start_at?: string /* date-time */ 
}
```
**Response 200** (`application/json`):
```ts
{
   already_existed: boolean;
   asn_id: string;
   inbound_id: string;
   status: string 
}
```

### §10 — Fulfillment (products, inventory, stock)

#### `POST /api/fulfilment/products`

**Request body** (`application/json`):
```ts
{
   availability_status: number;
   barcode?: string;
   batch_management?: boolean;
   cost_price?: number;
   country_code_of_origin?: string;
   currency: string;
   description?: string;
   dimensions?: {
     height: number;
     length: number;
     unit: string;
     width: number 
  };
   expiry_management?: boolean;
   harmonized_system_code?: string;
   image?: string;
   inbound_expiry_threshold_days?: number;
   inventory_tracked?: boolean;
   name?: string;
   outbound_expiry_threshold_days?: number;
   partner_product_id?: string;
   platform_price?: number;
   requires_shipping?: boolean;
   retail_price?: number;
   selling_price: number;
   sku: string;
   status?: string;
   total_sales?: number;
   track_expiry?: boolean;
   type?: string;
   vendor?: string;
   weight?: number;
   weight_unit?: string 
}
```
**Response 200** (`application/json`):
```ts
{
   availability_status?: number;
   barcode?: string;
   batch_management?: boolean;
   cost_price?: number;
   country_code_of_origin?: string;
   created_at?: string /* date-time */;
   currency?: string;
   description?: string;
   dimensions?: object;
   expiry_management?: boolean;
   harmonized_system_code?: string;
   id?: string;
   image?: string;
   inbound_expiry_threshold_days?: number;
   inventory_tracked?: boolean;
   name?: string;
   outbound_expiry_threshold_days?: number;
   partner_product_id?: string;
   platform_price?: number;
   requires_shipping?: boolean;
   retail_price?: number;
   selling_price?: number;
   sku?: string;
   status?: string;
   total_sales?: number;
   track_expiry?: boolean;
   type?: string;
   updated_at?: string /* date-time */;
   vendor?: string;
   weight?: number;
   weight_unit?: string 
}
```

#### `PUT /fulfillment/products`

**Request body** (`application/json`):
```ts
{
   barcode: string;
   batch_management: boolean;
   bundle_components: {
     bundle_sku: string;
     component_sku: string;
     created_at: string /* date-time */;
     id: number;
     quantity: number;
     updated_at: string /* date-time */;
     user_id: string 
  }[];
   country_code_of_origin: string;
   created_at: string /* date-time */;
   currency: string;
   dimensions: object;
   expiry_management: boolean;
   external_location_id: string;
   external_product_id: string;
   external_variant_id: string;
   follow_parent_stock: boolean;
   harmonized_system_code: string;
   id: number;
   image_url: string;
   inbound_expiry_threshold_days?: number;
   invnetory_tracked: boolean;
   is_bundle: boolean;
   is_dangerous_goods: boolean;
   outbound_expiry_threshold_days?: number;
   platform_price: object;
   price: object;
   product_description: string;
   product_inventory_item_id: number;
   product_name: string;
   product_type: string;
   quantity: number;
   shop_name: string;
   sku: string;
   source: string;
   status: string;
   track_expiry: boolean;
   updated_at: string /* date-time */;
   user_id: string;
   vendor: string;
   weight: object;
   weight_unit: string;
   wms_product_status: string;
   wms_sync_error_code: string;
   wms_sync_error_reason: string;
   wms_sync_failed_at: string /* date-time */;
   wms_sync_retry_count: number 
}
```
**Response 200** (`application/json`):
```ts
{
   product: {
     barcode: string;
     batch_management: boolean;
     bundle_components: object[];
     country_code_of_origin: string;
     created_at: string /* date-time */;
     currency: string;
     dimensions: object;
     expiry_management: boolean;
     external_location_id: string;
     external_product_id: string;
     external_variant_id: string;
     follow_parent_stock: boolean;
     harmonized_system_code: string;
     id: number;
     image_url: string;
     inbound_expiry_threshold_days?: number;
     invnetory_tracked: boolean;
     is_bundle: boolean;
     is_dangerous_goods: boolean;
     outbound_expiry_threshold_days?: number;
     platform_price: object;
     price: object;
     product_description: string;
     product_inventory_item_id: number;
     product_name: string;
     product_type: string;
     quantity: number;
     shop_name: string;
     sku: string;
     source: string;
     status: string;
     track_expiry: boolean;
     updated_at: string /* date-time */;
     user_id: string;
     vendor: string;
     weight: object;
     weight_unit: string;
     wms_product_status: string;
     wms_sync_error_code: string;
     wms_sync_error_reason: string;
     wms_sync_failed_at: string /* date-time */;
     wms_sync_retry_count: number 
  } 
}
```

#### `GET /fulfillment/products`

**Response 200** (`application/json`):
```ts
{
   products: {
     barcode: string;
     batch_management: boolean;
     bundle_components: object[];
     country_code_of_origin: string;
     created_at: string /* date-time */;
     currency: string;
     dimensions: object;
     expiry_management: boolean;
     external_location_id: string;
     external_product_id: string;
     external_variant_id: string;
     follow_parent_stock: boolean;
     harmonized_system_code: string;
     id: number;
     image_url: string;
     inbound_expiry_threshold_days?: number;
     invnetory_tracked: boolean;
     is_bundle: boolean;
     is_dangerous_goods: boolean;
     outbound_expiry_threshold_days?: number;
     platform_price: object;
     price: object;
     product_description: string;
     product_inventory_item_id: number;
     product_name: string;
     product_type: string;
     quantity: number;
     shop_name: string;
     sku: string;
     source: string;
     status: string;
     track_expiry: boolean;
     updated_at: string /* date-time */;
     user_id: string;
     vendor: string;
     weight: object;
     weight_unit: string;
     wms_product_status: string;
     wms_sync_error_code: string;
     wms_sync_error_reason: string;
     wms_sync_failed_at: string /* date-time */;
     wms_sync_retry_count: number 
  }[] 
}
```

#### `GET /fulfillment/products/list`

**Query params:**
- `limit`: `number` *(required)*
- `page`: `number` *(required)*
- `sort`: `string` *(required)*
- `sort_desc`: `boolean` *(required)*
- `sku`: `string` *(required)*
- `product_name`: `string` *(required)*
- `vendor`: `string`
- `status`: `string` *(required)*
- `source`: `string` *(required)*
- `is_bundle`: `string` *(required)*
- `sort_by`: `string` *(required)*
- `path`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   pagination: {
     next?: object;
     next_url?: string;
     prev?: object;
     prev_url?: string;
     total: number 
  };
   products: {
     barcode: string;
     batch_management: boolean;
     bundle_components: object[];
     country_code_of_origin: string;
     created_at: string /* date-time */;
     currency: string;
     dimensions: object;
     expiry_management: boolean;
     external_location_id: string;
     external_product_id: string;
     external_variant_id: string;
     follow_parent_stock: boolean;
     harmonized_system_code: string;
     id: number;
     image_url: string;
     inbound_expiry_threshold_days?: number;
     invnetory_tracked: boolean;
     is_bundle: boolean;
     is_dangerous_goods: boolean;
     outbound_expiry_threshold_days?: number;
     platform_price: object;
     price: object;
     product_description: string;
     product_inventory_item_id: number;
     product_name: string;
     product_type: string;
     quantity: number;
     shop_name: string;
     sku: string;
     source: string;
     status: string;
     track_expiry: boolean;
     updated_at: string /* date-time */;
     user_id: string;
     vendor: string;
     weight: object;
     weight_unit: string;
     wms_product_status: string;
     wms_sync_error_code: string;
     wms_sync_error_reason: string;
     wms_sync_failed_at: string /* date-time */;
     wms_sync_retry_count: number 
  }[] 
}
```

#### `GET /fulfillment/sync-products`

**Response 200** (`application/json`):
```ts
{
   status: string 
}
```

#### `GET /fulfillment/product/{sku}`

**Path params:**
- `sku`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   product: {
     barcode: string;
     batch_management: boolean;
     bundle_components: object[];
     country_code_of_origin: string;
     created_at: string /* date-time */;
     currency: string;
     dimensions: object;
     expiry_management: boolean;
     external_location_id: string;
     external_product_id: string;
     external_variant_id: string;
     follow_parent_stock: boolean;
     harmonized_system_code: string;
     id: number;
     image_url: string;
     inbound_expiry_threshold_days?: number;
     invnetory_tracked: boolean;
     is_bundle: boolean;
     is_dangerous_goods: boolean;
     outbound_expiry_threshold_days?: number;
     platform_price: object;
     price: object;
     product_description: string;
     product_inventory_item_id: number;
     product_name: string;
     product_type: string;
     quantity: number;
     shop_name: string;
     sku: string;
     source: string;
     status: string;
     track_expiry: boolean;
     updated_at: string /* date-time */;
     user_id: string;
     vendor: string;
     weight: object;
     weight_unit: string;
     wms_product_status: string;
     wms_sync_error_code: string;
     wms_sync_error_reason: string;
     wms_sync_failed_at: string /* date-time */;
     wms_sync_retry_count: number 
  } 
}
```

#### `POST /fulfillment/sync-products`

**Response 200** (`application/json`):
```ts
{
   status: string 
}
```

#### `POST /fulfillment/products/{sku}/trigger-workflow`

**Path params:**
- `sku`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `DELETE /fulfillment/products`

**Query params:**
- `product_ids`: `number[]` *(required)*

**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `GET /fulfillment/inventory`

**Query params:**
- `limit`: `number` *(required)*
- `page`: `number` *(required)*
- `sort`: `string` *(required)*
- `sku`: `string` *(required)*
- `product_name`: `string` *(required)*
- `vendor`: `string`
- `bucket`: `string`
- `sort_by`: `string` *(required)*
- `sort_desc`: `boolean` *(required)*
- `path`: `string` *(required)*
- `inbound_state`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   items: {
     Product: object;
     available: number;
     cost: string;
     country_code_of_origin: string;
     country_harmonized_system_codes: object;
     created_at: string /* date-time */;
     damaged?: number;
     external_location_id: string;
     harmonized_system_code: string;
     id: number;
     inbound_state: string;
     inventory_item_id: number;
     location: object;
     movement_ctx?: object;
     product_id: number;
     province_code_of_origin: string;
     qc_hold?: number;
     requires_shipping: boolean;
     reserved?: number;
     sku: string;
     source: string;
     tracked: boolean;
     updated_at: string /* date-time */;
     user_id: string 
  }[];
   pagination: {
     next?: object;
     next_url?: string;
     prev?: object;
     prev_url?: string;
     total: number 
  } 
}
```

#### `GET /api/fulfilment/inventory`

**Query params:**
- `limit`: `number`
- `page`: `number`
- `sku`: `string`
- `product_name`: `string`
- `vendor`: `string`
- `sort`: `string`
- `sort_desc`: `boolean`

**Response 200** (`application/json`):
```ts
{
   inventory: {
     available?: number;
     cost?: string;
     created_at?: string /* date-time */;
     damaged?: number;
     expiry_groups?: object[];
     inbound_state?: string;
     product?: object;
     product_id?: string;
     qc_hold?: number;
     reserved?: number;
     total?: number;
     tracked?: boolean;
     updated_at?: string /* date-time */;
     vendor?: string 
  }[];
   pagination: {
     next?: object;
     next_url?: string;
     prev?: object;
     prev_url?: string;
     total: number 
  } 
}
```

#### `GET /fulfillment/cbm/history`

**Query params:**
- `from`: `string` *(required)*
- `to`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   records: {
     client_id: string;
     created_at: string /* date-time */;
     date: string /* date-time */;
     id: number;
     rolling_avg: number;
     updated_at: string /* date-time */;
     value: number 
  }[] 
}
```

#### `GET /fulfillment/inventory-total`

**Response 200** (`application/json`):
```ts
{
   total_units: number 
}
```

#### `POST /fulfillment/sync-inventory`

**Request body** (`application/json`):
```ts
{
   sku_list: string[];
   user_id: string 
}
```
**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

#### `GET /fulfillment/sync-inventory-state`

**Response 200** (`application/json`):
```ts
{
   status: string 
}
```

#### `GET /fulfillment/inventory-snapshot/export`

**Query params:**
- `date`: `string` *(required)*
- `sku`: `string`
- `search`: `string`
- `bucket`: `string`

**Response 200** (`application/json`):
```ts
{
   csv: string 
}
```

#### `GET /fulfillment/inventory-snapshot`

**Query params:**
- `date`: `string` *(required)*
- `sku`: `string`
- `search`: `string`
- `bucket`: `string`
- `limit`: `number`
- `page`: `number`
- `path`: `string`

**Response 200** (`application/json`):
```ts
{
   date: string;
   earliest_available_date: string;
   items: {
     available: number;
     cost: string;
     country_code_of_origin: string;
     damaged: number;
     harmonized_system_code: string;
     product: object;
     qc_hold: number;
     reserved: number;
     sku: string;
     updated_at: string /* date-time */ 
  }[];
   pagination: {
     next?: object;
     next_url?: string;
     prev?: object;
     prev_url?: string;
     total: number 
  } 
}
```

#### `GET /api/fulfilment/inventory/{sku}/batches`

**Path params:**
- `sku`: `string` *(required)*

**Query params:**
- `batch_number`: `string`
- `expiring_before`: `string`

**Response 200** (`application/json`):
```ts
{
   batches: {
     available: number;
     batch_number: string;
     created_at: string /* date-time */;
     expiry_date?: string;
     id: string;
     manufacturing_date?: string;
     unusable: number;
     updated_at: string /* date-time */ 
  }[] 
}
```

#### `POST /api/fulfilment/inventory/adjustments`

**Request body** (`application/json`):
```ts
{
   bucket: string;
   notes?: string;
   quantity_change: number;
   reason: string;
   sku: string 
}
```
**Response 200** (`application/json`):
```ts
{
   available: number;
   damaged: number;
   qc_hold: number;
   reserved: number;
   sku: string;
   total: number 
}
```

### §11 — Shipments & Carriers

#### `GET /shipments`

**Query params:**
- `client_order_id`: `string` *(required)*
- `shipment_id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   carrier: string;
   client_id: string;
   client_order_id: string;
   core_api_order_id: string;
   destination_country: string;
   documents: {
     created_at: string /* date-time */;
     document_id: string;
     filename: string;
     format: string;
     type: string;
     uri: string 
  }[];
   errors: string[];
   incoterms: string;
   inserted_at: string /* date-time */;
   origin_country: string;
   shipment_id: string;
   state: string;
   tracking_id: string;
   tracking_url: string;
   updated_at: string /* date-time */ 
}
```

#### `GET /shipments/carriers/capabilities`

**Response 200** (`application/json`):
```ts
{
   carriers: {
     carrier_name: string;
     carrier_type: string;
     customs_threshold_amount?: number;
     features: object;
     incoterms: object[];
     supported_countries: object 
  }[] 
}
```

#### `POST /shipments/rates`

**Request body** (`application/json`):
```ts
{
   carrier_accounts: string[];
   destination: {
     address1: string;
     address2: string;
     city: string;
     country: string;
     postcode: string 
  };
   origin: {
     address1: string;
     address2: string;
     city: string;
     country: string;
     postcode: string 
  };
   parcel: {
     description: string;
     height: number;
     length: number;
     number_of_parcels: number;
     weight: number;
     width: number 
  } 
}
```
**Response 200** (`application/json`):
```ts
{
   rates: {
     carrier: string;
     total_rate: object;
     total_rate_currency: string 
  }[] 
}
```

### §12 — Shipping Profiles (Dispatcher Rule Sets)

#### `GET /partner/dispatcher/rule-sets`

**Response 200** (`application/json`):
```ts
{
   rule_sets: {
     default_rule_set: boolean;
     id: number;
     merchants: string[];
     name: string;
     pickup_country: string;
     rules: object[] 
  }[] 
}
```

#### `POST /partner/dispatcher/rule-sets`

**Request body** (`application/json`):
```ts
{
   default_rule_set: boolean;
   merchants: string[];
   name: string;
   pickup_country: string;
   rules: {
     active: boolean;
     carrier_accounts: string[];
     carrier_incoterm: string;
     carrier_name: string;
     conditions: object[];
     merchants: string[];
     name: string 
  }[] 
}
```
**Response 200** (`application/json`):
```ts
{
   default_rule_set: boolean;
   id: number;
   merchants: string[];
   name: string;
   pickup_country: string;
   rules: {
     active: boolean;
     carrier_accounts: string[];
     carrier_incoterm: string;
     carrier_name: string;
     conditions: object[];
     id: number;
     merchants: string[];
     name: string 
  }[] 
}
```

#### `PUT /partner/dispatcher/rule-sets/{id}`

**Path params:**
- `id`: `number` *(required)*

**Request body** (`application/json`):
```ts
{
   default_rule_set: boolean;
   merchants: string[];
   name: string;
   pickup_country: string;
   rules: {
     active: boolean;
     carrier_accounts: string[];
     carrier_incoterm: string;
     carrier_name: string;
     conditions: object[];
     merchants: string[];
     name: string 
  }[] 
}
```
**Response 200** (`application/json`):
```ts
{
   default_rule_set: boolean;
   id: number;
   merchants: string[];
   name: string;
   pickup_country: string;
   rules: {
     active: boolean;
     carrier_accounts: string[];
     carrier_incoterm: string;
     carrier_name: string;
     conditions: object[];
     id: number;
     merchants: string[];
     name: string 
  }[] 
}
```

#### `DELETE /partner/dispatcher/rule-sets/{id}`

**Path params:**
- `id`: `number` *(required)*

**Response 200:** _no body_

### §13 — Returns (REST request flow)

#### `GET /api/accounts/{accountID}/return-requests`

**Path params:**
- `accountID`: `string` *(required)*

**Query params:**
- `status`: `string` *(required)*
- `date_from`: `string` *(required)*
- `date_to`: `string` *(required)*
- `reason_code`: `string` *(required)*
- `client_order_id`: `number` *(required)*
- `sort_by`: `string` *(required)*
- `sort_desc`: `boolean` *(required)*
- `page`: `number` *(required)*
- `per_page`: `number` *(required)*

**Response 200** (`application/json`):
```ts
{
   items: {
     client_order_id: number;
     created_at: string /* date-time */;
     id: string;
     order_id: string;
     reason_code: string;
     status: string;
     total_return_value: object 
  }[];
   page: number;
   per_page: number;
   total: number;
   total_pending_count: number 
}
```

#### `GET /api/return-reasons`

**Response 200** (`application/json`):
```ts
{
   reasons: {
     code: string;
     label_client: string;
     label_customer: string;
     sub_reasons: domain.ReturnReasonResponse[] 
  }[] 
}
```

#### `GET /api/return-requests/{requestID}`

**Path params:**
- `requestID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   account_id: string;
   approved_at: string /* date-time */;
   approved_by: string;
   client_order_id: number;
   created_at: string /* date-time */;
   customer_notes: string;
   id: string;
   items: {
     description: string;
     quantity: number;
     selling_price: number;
     sku: string 
  }[];
   order_id: string;
   reason_code: string;
   rejected_at: string /* date-time */;
   rejection_notes: string;
   rejection_reason_code: string;
   return_order_id: string;
   status: string;
   sub_reason_code: string;
   total_return_value: object;
   updated_at: string /* date-time */ 
}
```

#### `POST /api/return-requests/{requestID}/approve`

**Path params:**
- `requestID`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   mirsal2_code: string 
}
```
**Response 200** (`application/json`):
```ts
{
   return_order_id: string;
   status: string 
}
```

#### `POST /api/return-requests/{requestID}/reject`

**Path params:**
- `requestID`: `string` *(required)*

**Request body** (`application/json`):
```ts
{
   rejection_notes: string;
   rejection_reason_code: string 
}
```
**Response 200:** _no body_

### §14 — Stripe / payment methods

#### `GET /quiqdash/payments/setup-intent`

**Response 200** (`application/json`):
```ts
{
   client_secret: string 
}
```

#### `GET /quiqdash/payments/customer-session`

**Response 200** (`application/json`):
```ts
{
   client_secret: string 
}
```

#### `GET /quiqdash/payments/users/me`

**Response 200** (`application/json`):
```ts
{
   user: {
     email: string;
     has_payment_method: boolean;
     id: string;
     must_have_bank_card: boolean;
     salesforce_id: string;
     stripe_customer_id: string 
  } 
}
```

#### `GET /quiqdash/payments/payment-methods`

**Response 200** (`application/json`):
```ts
{
   payment_methods: object[] 
}
```

#### `GET /quiqdash/payments/payment-methods/{paymentMethodID}`

**Path params:**
- `paymentMethodID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   payment_method: object 
}
```

#### `DELETE /quiqdash/payments/payment-methods/{paymentMethodID}`

**Path params:**
- `paymentMethodID`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   message: string 
}
```

### §15 — Notifications

#### `GET /quiqdash/notifications`

**Response 200** (`application/json`):
```ts
{
   operation: {
     operational: boolean 
  };
   segmentation: {
     message_body: string;
     message_title: string;
     order_placement_allowed: boolean 
  } 
}
```

### §16 — Metabase report tokens

#### `GET /quiqdash/reports/token/{id}`

**Path params:**
- `id`: `string` *(required)*

**Query params:**
- `userKey`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   token: string 
}
```

#### `GET /quiqdash/reports/token-unsafe/{id}`

**Path params:**
- `id`: `string` *(required)*

**Response 200** (`application/json`):
```ts
{
   token: string 
}
```
---

## §19 B — Quiqup REST + Audit (inferred from client)

These endpoints are called via `useQuiqupApi` / direct `fetch` but the openapi-react-query path is hard-cast (`as any`) because no published OpenAPI schema covers them. Shapes below are taken from the consumer code and (where present) from typed structs in `app/lib/orders.ts`.

### `GET /orders/{id}/history` (Quiqup REST)

**Path params:**
- `id`: `string` *(required)* — integer `clientOrderID` rendered as string.

**Response 200** (typed in `app/lib/orders.ts:478` as `OrderHistoryResponse`):
```ts
{
   history: {
     to_state: string;
     occurred_at: string /* ISO date-time */;
     author: {
       email: string;
       fullname: string;
       role: string
     } | null;
     custodian: {
       custodian_name: string;
       custodian_type: string
     };
     delivery_metrics: {
       calls: number;
       messages: number
     };
     on_hold_reason: string | null;
     reason: string | null;
     return_to_origin_reason: string | null;
     internal_order: {
       id: string;
       type: string;
       job_id: string | null;
       delivery_failure_reason: string | null;
       mission: {
         id: string;
         kind: string;
         state: string;
         state_updated_at: string
       } | null;
       origin: {
         customer_identification_photo: string | null;
         proof_of_delivery_photos: string[];
         receipts: { amount: string; transaction_type: string }[];
         signature: { url: string | null }
       };
       destination: {
         customer_identification_photo: string | null;
         proof_of_delivery_photos: string[];
         receipts: { amount: string; transaction_type: string }[];
         signature: { url: string | null }
       }
     } | null;
     events: unknown[]
  }[]
}
```

### `PUT /orders/export/{id}` (Quiqup REST)

Updates an exported (international) order. Path param `id` is `clientOrderID`. **Request body** matches the order-edit form output (origin / destination addresses, weight, items, products, payment) — server expects the same shape consumed by `transformGraphQLOrderDetails` on the way in, minus IDs/timestamps. **Response** is the updated order; the client only checks `response.ok` and refetches via Relay.

### `GET /orders/partner-cancellation-reasons` (Platform — schema gap)

Not in `openapi.json` (cast `as any`). **Response** observed shape (matches reason-source endpoints in §4):
```ts
{
   reasons: { name: string }[]
}
```
Used directly as `{ label: name, value: name }` options in the cancel-order dialog.

### `GET {AUDIT_BASE_URL}/events?resourceID.eq={orderUuid}` (Audit service)

Untyped on the client (`any`). **Query params:**
- `resourceID.eq`: `string` — order UUID.

**Response 200**: an array of audit-event records. Each record carries `{ eventID, resourceID, occurredAt, actor, action, changes }`. The consumer (`useGetAuditLog`) stores the whole response object in component state without parsing; the order-details audit log panel renders rows by reading `data.events[*]`.

### `PUT /shipments/{shipment_id}/update-carrier-details` (Platform — schema gap)

Cast `as any` in `useUpdateCarrierDetails`. Body is the carrier-edit form output:
```ts
{
   carrier_name: string;
   tracking_number?: string;
   incoterm?: string
}
```
**Response 200**: `{ message: string }` (toast-only consumer).

---

## §19 C — Invoicer (Zoho) — typed in BE, untyped in `openapi.json`

The Invoicer service runs against its own host (`VITE_INVOICER_BASE_URL`) and isn't merged into the platform spec, so all four hooks are cast `as any`. Shapes below are from how the finance pages consume them.

### `GET /zoho/invoices`

**Response 200**:
```ts
{
   invoices: {
     invoice_id: string;
     invoice_number: string;
     date: string /* yyyy-mm-dd */;
     due_date: string /* yyyy-mm-dd */;
     status: "draft" | "sent" | "overdue" | "paid" | "void" | string;
     total: number;
     balance: number;
     currency_code: string;
     customer_name: string
  }[]
}
```

### `GET /zoho/invoice/{invoiceId}/pdf`

**Path params:** `invoiceId: string`.
**Response 200:** binary PDF (`Content-Type: application/pdf`). Saved by the client as `{invoiceId}.pdf` via FileSaver.

### `GET /zoho/credit-notes`

**Response 200**:
```ts
{
   credit_notes: {
     creditnote_id: string;
     creditnote_number: string;
     date: string;
     status: string;
     total: number;
     currency_code: string;
     reference_invoice_id?: string;
     customer_name: string
  }[]
}
```

### `GET /zoho/creditnote/{creditNoteId}/pdf`

**Path params:** `creditNoteId: string`.
**Response 200:** binary PDF.

---

## §19 D — Salla REST (typed in client)

Salla types live in `app/hooks/integration/salla-types.ts`. All endpoints sit behind the platform host but Salla-specific hooks use raw `fetch` to get a typed `HttpError` (so callers can branch on 404 vs 5xx).

### `GET /integrations/install/salla`
**Response 200**: `{ url: string }` — Salla OAuth URL.

### `GET /integrations/connections/{id}`
**Path params:** `id: string`.
**Response 200** (envelope unwrapped by the hook):
```ts
{
   connection: {
     id: string;
     shop_name: string;
     site_url: string;
     source: "salla";
     user_id: string;
     is_fulfillment: boolean;
     created_at: string /* ISO */;
     updated_at: string /* ISO */
  }
}
```
Note: BE also sends a `token` field; the client deliberately omits it from the type so it can't be logged.

### `DELETE /integrations/connections/{id}`
**Response 200**: empty.

### `PUT /integrations/connections/{id}/fulfillment`
**Request body**: `{ is_fulfillment: boolean }`.
**Response 200**: empty.

### `GET /integrations/configs/{connectionId}/platform-data`
**Response 200**:
```ts
{
   shipping_methods: {
     id: string;
     code: string;
     title: string;
     kind?: "in_house" | "external" | "unknown"
  }[];
   locations: { id: string; name: string }[]
}
```

### `GET /integrations/configs/{connectionId}`
404 = "no config saved yet" (returns `null` to the consumer).
**Response 200** (envelope unwrapped):
```ts
{
   config: {
     delivery_methods: {
       platform_method: string;
       platform_method_id: string;
       service_kind: string;
       shipping_profile_id?: string
    }[];
     locations: {
       platform_location_id: string;
       warehouse_id: string
    }[];
     initial_order_states: string[];
     awb_trigger: "pending" | "ready_for_collection" | "at_depot"
                 | "out_for_delivery" | "on_shipment_webhook"
                 | "ready_for_collection_or_webhook";
     country_filter: string[];
     sync_products: boolean;
     auto_mark_as_rfc: boolean;
     wms_delay_minutes: number;
     is_manual_international_order_confirmed: boolean
  }
}
```

### `PUT /integrations/configs/{connectionId}`
**Request body**: the unwrapped `config` shape above (no envelope on write).
**Response 200**: empty.

---

## §19 E — GraphQL queries (Relay)

Three queries hit the Orders Core GraphQL endpoint (`VITE_ORDERS_API_GRAPH_URL`). For Relay, the query text **is** the response shape — fields requested are fields returned. Inputs are the GraphQL variables.

### `ordersListingQuery` — orders dashboard

File: `app/graphql/queries/orders-listing.query.ts`

**Variables:**
```ts
{
   first?: number;
   last?: number;
   after?: string;   // Cursor
   before?: string;  // Cursor
   where?: OrderWhereInput;   // built by buildOrderFilters(searchFilter)
   orderBy?: { field: "SUBMITTED_AT"; direction: "ASC" | "DESC" }
}
```

**Selection set** (response shape):
```graphql
orders(first, last, after, before, where, orderBy) {
  edges {
    node {
      id state uuid serviceKind carrier onHoldReason shipmentErrors
      partnerOrderID paymentAmount paymentMode totalAmount weight
      submittedAt deliveryAttempts clientOrderID source trackingNumber
      stateUpdatedAt scheduledFor brandName externalOrderID references
      region weightUnit currency
      products { hsCode description countryOfOrigin }
      origin {
        city contactName contactPhone contactEmail country emirate
        address { address1 address2 country metadata ksaNationalAddress }
      }
      destination {
        city contactEmail contactName contactPhone country emirate
        address { address1 address2 country metadata ksaNationalAddress }
      }
      items { id parcelBarcode }
    }
  }
  pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
  totalCount
}
```

The companion `ordersListingIdsQuery` (same file) requests only `edges.node.clientOrderID` — used by the listing's "select all matching" flow.

### `orderDetailsQuery` — single order detail

File: `app/graphql/queries/order-details.query.ts`

**Variables:** `{ clientOrderId: number }`.

**Selection set** (response shape): everything in `ordersListingQuery` plus:
```graphql
node {
  regionName billingIdentifier trackingURL itemQuantityCount collectionAttempts
  deliveryFailureReason requiredDocuments allowedPaymentTypes displayItemsInfo
  collectionAfter collectionBefore deliveryAfter deliveryBefore
  missionID courierID shipmentID initialOrderID returnOrderID
  confidence printLabel userEmail userFullname
  origin {
    /* listing fields, plus: */
    town postcode notes arrivedAt completedAt trackingToken trackingURL
    coordinates apartmentNumber buildingName address1 address2 addressCountry
    address {
      /* listing fields, plus: */
      postcode city town coordinates apartmentNumber buildingName
    }
  }
  destination { /* same superset as origin */ }
  items {
    id name quantity weight height width length sku parcelBarcode
    parcelBarcodeGeneratedBy category subcategory unitPrice totalPrice fragile
  }
  products {
    id name description hsCode countryOfOrigin sku quantity sellingPrice
    weight height width length brand category fragile perishable
  }
}
```

### `bulkOrdersLookupQuery` — bulk weight / mission re-fetch

File: `app/graphql/queries/bulk-orders-lookup.query.ts`

**Variables:** `{ where?: OrderWhereInput }` — call sites pass `{ clientOrderIDIn: number[] }`.

**Selection set:**
```graphql
orders(first: 200, where) {
  edges {
    node {
      id uuid clientOrderID state
      items {
        id name parcelBarcode parcelBarcodeGeneratedBy quantity weight
      }
    }
  }
}
```

---

## §19 F — Supabase (Returns Hub + Client Portal)

Tables and RPCs are public via Supabase Row Level Security; the Clerk JWT carries `client_id` so RLS filters automatically for non-admins. Columns below come from the column-list constants in `app/hooks/fulfillment/returns/constants.ts`.

### RPC `get_returns_hub_metrics()`
Returns a single row, used by `useReturnsHubData`:
```ts
{
   pending_qa_qc_count: number | string;
   awaiting_approval_count: number | string;
   awaiting_client_confirmation_count: number | string;
   ready_for_asn_count: number | string;
   awaiting_dispatch_count: number | string;
   inventory_units_count: number | string
}
```
(The hook coerces strings to numbers via `mapReturnsHubMetricsRow`.)

### Table `return_orders`
List view columns (`ORDER_LIST_COLUMNS`):
```
id, quiqup_order_id, partner_order_id, return_type, status,
creation_date, last_updated_at, client_id, manager_rejection_reason
```
Detail columns (`ORDER_DETAIL_COLUMNS`) — adds `returns_procedure`.

Typed in `app/hooks/fulfillment/returns/types.ts`:
```ts
{
   id: string;
   quiqup_order_id: string | null;
   partner_order_id: string | null;
   return_type: string | null;
   status: "created" | "qa/qc_completed" | "qa/qc_approved"
         | "confirmed_client" | "partially_returned" | "returned";
   creation_date: string | null;
   last_updated_at: string | null;
   client_id: string;
   manager_rejection_reason: string | null;
   returns_procedure?: string | null
}
```

Status-filter aggregation buckets (`STATUS_FILTER_MAP`):
- `awaiting` → `["qa/qc_approved"]`
- `processing` → `["created", "qa/qc_completed"]`
- `confirmed` → `["confirmed_client"]`
- `dispatched` → `["partially_returned", "returned"]`
- `all` → no filter.

Page size: `RETURN_ORDERS_PAGE_SIZE = 50` (passed to `.range(from, to)`).

### Table `skus` (`SKU_DETAIL_COLUMNS`)
```ts
{
   id: string;
   return_order_id: string;
   sku_code: string | null;
   sku_barcode: string | null;
   sku_name: string | null;
   original_quantity: number | null;
   received_quantity: number | null
}
```

### Table `units` (`UNIT_DETAIL_COLUMNS`)
```ts
{
   id: string;
   return_order_id: string;
   sku_id: string | null;
   status: string | null;
   qa_qc_status: string | null;  // "fail" | "pass" | ...
   qa_qc_date: string | null;
   qa_qc_user: string | null;
   qa_confirmed_by: string | null;
   failure_reason: string | null;
   location_id: string | null;
   asn_id: string | null;
   pictures: string[] | Record<string, string> | null
}
```
`useFailedUnitCounts` reads only `return_order_id` filtered by `qa_qc_status = "fail"` and groups client-side.

`useClientPortalMetrics` issues 5 parallel `select("status", { count: "exact", head: true })` calls against `return_orders`, varying the status filter; each returns `{ data: null, count: number | null, error }`.

---

## §19 G — Mastra (AI agent chat)

### `POST {VITE_MASTRA_URL}/chat/operationsAgent` (SSE stream)

Driven by the Vercel AI SDK's `useChat`. **Request body** is the SDK's standard `messages` array:
```ts
{
   id: string;                 // thread id
   messages: {
     id: string;
     role: "user" | "assistant" | "system" | "data";
     content: string;
     parts?: MessagePart[];
     toolInvocations?: ToolPart[];
     createdAt?: string
  }[];
   data?: Record<string, unknown>
}
```

**Response**: SSE stream (`Content-Type: text/event-stream`). Frames follow the AI SDK Data Stream Protocol — each line is `<kind>:<json>\n`:
- `0:"text"` — text-delta tokens for the assistant message.
- `2:[...]` — message-annotation data (custom metadata).
- `9:{...}` — tool-call (`{ toolCallId, toolName, args }`).
- `a:{...}` — tool-call result (`{ toolCallId, result }`).
- `f:{...}` — message metadata (`{ messageId }`).
- `d:{...}` — finish event (`{ finishReason, usage }`).

The client renders frames via `app/components/chat/render-message-part.tsx`; tool-call results trigger refetches handled by `useAgentToolEffects`.

### `GET {VITE_MASTRA_URL}/api/memory/threads/{threadId}`

**Path params:** `threadId: string`.

**Response 200**:
```ts
{
   id: string;
   resourceId: string;
   title?: string;
   metadata?: Record<string, unknown>;
   messages: {
     id: string;
     role: "user" | "assistant" | "tool";
     content: string;
     parts?: MessagePart[];
     createdAt: string
  }[]
}
```

On 401 the `mastraFetch` wrapper refreshes the Clerk token and retries once; a second 401 raises `AuthenticationError`.

---

## §19 H — Direct file uploads / downloads

These hooks bypass openapi-react-query for multipart uploads and binary downloads.

### `POST /quiqdash/bulk_orders` (Platform — multipart)
**Form fields:** `file` (CSV).
**Response 200:** opaque (the client only reads `response.ok`); errors return JSON `{ error: string }` which propagates up.

### `POST /orders-by-client-id/{clientOrderID}/documents` (Orders Core — multipart)
**Path params:** `clientOrderID: number`.
**Form fields:** `file`, `document_type: "proof_of_delivery"`, `admin_override: "true"`.
**Response 200:** empty (client only checks `response.ok`).

### `POST /api/fulfilment/products/bulk/validate` (Platform — multipart)
**Form fields:** `file` (CSV).
**Response 200** (typed manually in `app/hooks/fulfillment/use-bulk-product-upload.tsx:18`):
```ts
{
   total_rows: number;
   valid_rows: number;
   invalid_rows: number;
   duplicate_rows: number;
   rows: {
     row_number: number;
     sku?: string;
     name?: string;
     cost_price?: number | string;
     currency?: string;
     status: "valid" | "invalid" | "duplicate" | "duplicate_in_file";
     errors?: string[]
  }[]
}
```

### `POST /api/fulfilment/products/bulk/commit` (Platform — multipart)
**Form fields:** `file` (CSV), `update_duplicates` (`"true"` | `"false"`).
**Response 200:**
```ts
{
   total_rows: number;
   created: number;
   updated: number;
   skipped: number;
   failed: number;
   rows: {
     row_number: number;
     sku?: string;
     status: "created" | "updated" | "skipped" | "failed";
     errors?: string[]
  }[]
}
```

### `GET /api/fulfillment/download_stock` (ex-core)
**Response 200:** CSV blob (`text/csv`). Saved by `downloadFile()` helper.

### `GET /orders/download?from=&to=&filters[order_id]=&per_page=` (ex-core)
**Query params:** `from`, `to` (yyyy-mm-dd), `filters[order_id]` (comma-separated IDs), `per_page` (number).
**Response 200:** CSV blob.

### `GET /pending_orders_labels` (Quiqup GraphQL host, REST endpoint — PDF)
**Response 200:** binary PDF (all pending order labels concatenated).

### `GET /order_label/{order_ids}` (Quiqup GraphQL host — PDF)
**Path:** comma-separated IDs.
**Response 200:** binary PDF.

### `GET /return_order_label/{orderId}` (Quiqup GraphQL host — PDF)
**Response 200:** binary PDF.

### `GET /slips/{slipType}?order_ids=...` (Platform — PDF)
**Path:** `slipType` in `"picking-list" | "packing-list"`.
**Headers:** `api-version: 20180108`, `Accept: application/pdf`.
**Response 200:** binary PDF.

### `GET /fulfillment/inventory-snapshot/export` (Platform — CSV)
Issued via `api.useMutation("get", ...)`. **Query params** mirror `useGetInventorySnapshot` (`date`, `page`, `limit`, `sku`, `search`, `bucket`).
**Response 200:** CSV blob.

### `GET {VITE_PLACES_BASE_URL}/v1/places/{placeId}` (Google Places — REST)
**Headers:** `X-Goog-Api-Key: <VITE_GOOGLE_GEO_CODING_API_KEY>`, `X-Goog-FieldMask: displayName,formattedAddress`.
**Response 200:**
```ts
{
   displayName: { text: string; languageCode: string };
   formattedAddress: string
}
```

### `POST {VITE_INVENTORY_API_URL}` (n8n webhook — AI inventory insights)
**Request body:** account-scoped inventory snapshot (shape defined by the n8n workflow; client passes whatever the page collects).
**Response 200:** untyped JSON (rendered as-is in the Inventory Insights panel).

---

## §19 I — Internal React Router routes (own server)

### `POST /api/generate-actor-token`
**Request body:**
```ts
{
   userId: string /* email of impersonation target, validated by Zod */
}
```
**Response 200:** `{ token: string; url: string }`.
**Errors:** `400` (invalid body / not found), `401` (caller unauthenticated), `403` (caller not a Quiqup org member), `405` (method ≠ POST), `500`.

### `GET /api/download-document?url=<...>&filename=<...>`
**Query params:**
- `url`: HTTPS URL on an allowlisted host (GCS, S3 regional variants, Azure Blob).
- `filename`: arbitrary; sanitized to `[a-zA-Z0-9._-]`.

**Response 200:** binary blob with `Content-Type` chosen from `["application/pdf", "image/png", "image/jpeg", "application/octet-stream"]` and `Content-Disposition: attachment; filename="<sanitized>"`.
**Errors:** `400` (missing/invalid URL), `401`, `500`.

### `GET /api/health`
**Response 200:** `{ status: "ok" }`. Never authenticated.

---
