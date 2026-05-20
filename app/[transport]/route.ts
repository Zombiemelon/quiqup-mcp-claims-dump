import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { auth } from "@clerk/nextjs/server";
import { registerClaimsDump } from "@/lib/tools/claims-dump";
import { registerRecentOrders } from "@/lib/tools/recent-orders";
import { registerTool } from "@/lib/tools/register";

// M2 — fully tested, mocked, error-mapped.
import { spec as getLastmileOrderSpec } from "@/lib/tools/get-lastmile-order";

// Diagnostic — confirms the exchanged session-JWT resolves on platform-api.
import { spec as whoamiPlatformSpec } from "@/lib/tools/whoami-platform";

// M3 thin pass-through reads (Last-Mile + Fulfilment).
// TODO(M4): cassette + output schemas + error mapping for these.
import { spec as getLastmileOrderLabelSpec } from "@/lib/tools/get-lastmile-order-label";
import { spec as getFulfilmentOrderSpec } from "@/lib/tools/get-fulfilment-order";
import { spec as listInventorySpec } from "@/lib/tools/list-inventory";
import { spec as getInventoryBySkuSpec } from "@/lib/tools/get-inventory-by-sku";
import { spec as listSkuBatchesSpec } from "@/lib/tools/list-sku-batches";
import { spec as getBatchSpec } from "@/lib/tools/get-batch";
import { spec as listInboundSlotsSpec } from "@/lib/tools/list-inbound-slots";
import { spec as listInboundsSpec } from "@/lib/tools/list-inbounds";
import { spec as getInboundSpec } from "@/lib/tools/get-inbound";
import { spec as getInboundStateHistorySpec } from "@/lib/tools/get-inbound-state-history";
import { spec as getInboundItemsSpec } from "@/lib/tools/get-inbound-items";
import { spec as getProductBySkuSpec } from "@/lib/tools/get-product-by-sku";

// Phase 1: account + permissions + reference-data reads.
import { spec as getAccountSpec } from "@/lib/tools/get-account";
import { spec as getPermissionsSpec } from "@/lib/tools/get-permissions";
import { spec as getAccountCapabilitiesSpec } from "@/lib/tools/get-account-capabilities";
import { spec as getAccountByIdSpec } from "@/lib/tools/get-account-by-id";
import { spec as getQuiqdashInitSpec } from "@/lib/tools/get-quiqdash-init";
import { spec as listServiceKindsSpec } from "@/lib/tools/list-service-kinds";
import { spec as listQuiqupOrderStatesSpec } from "@/lib/tools/list-quiqup-order-states";

// Phase 1: addresses, geo lookups, reason codes (ADDR-01..08 + ORDL-08..12).
import { spec as listAccountAddressesSpec } from "@/lib/tools/list-account-addresses";
import { spec as createPartnerAddressSpec } from "@/lib/tools/create-partner-address";
import { spec as updatePartnerAddressSpec } from "@/lib/tools/update-partner-address";
import { spec as listCountriesSpec } from "@/lib/tools/list-countries";
import { spec as listCountryStatesSpec } from "@/lib/tools/list-country-states";
import { spec as listCountryCitiesSpec } from "@/lib/tools/list-country-cities";
import { spec as listStateCitiesSpec } from "@/lib/tools/list-state-cities";
import { spec as lookupGooglePlaceSpec } from "@/lib/tools/lookup-google-place";
import { spec as listPartnerCancellationReasonsSpec } from "@/lib/tools/list-partner-cancellation-reasons";
import { spec as listOnHoldReasonsSpec } from "@/lib/tools/list-on-hold-reasons";
import { spec as listReturnToOriginReasonsSpec } from "@/lib/tools/list-return-to-origin-reasons";
import { spec as listCancellationReasonsSpec } from "@/lib/tools/list-cancellation-reasons";
import { spec as listCourierFailureReasonsSpec } from "@/lib/tools/list-courier-failure-reasons";

// Phase 1: account + return-settings writes + feature flags (AUTH-07/10/11/12/13).
import { spec as updateAccountSpec } from "@/lib/tools/update-account";
import { spec as decideFeatureFlagsBulkSpec } from "@/lib/tools/decide-feature-flags-bulk";
import { spec as getReturnSettingsSpec } from "@/lib/tools/get-return-settings";
import { spec as updateReturnSettingsSpec } from "@/lib/tools/update-return-settings";
import { spec as createAccountTeamMemberSpec } from "@/lib/tools/create-account-team-member";

// Phase 2: shared integrations surface (INTG-01/03/04/05/06).
import { spec as listIntegrationConnectionsSpec } from "@/lib/tools/list-integration-connections";
import { spec as listIntegrationOrderReasonsSpec } from "@/lib/tools/list-integration-order-reasons";
import { spec as repairIntegrationOrdersSpec } from "@/lib/tools/repair-integration-orders";
import { spec as getIntegrationOrderSpec } from "@/lib/tools/get-integration-order";
import { spec as confirmFfExportSpec } from "@/lib/tools/confirm-ff-export";

// Phase 2: Shopify integration (INTG-07/08/09/10/11/12).
import { spec as getShopifyConfigSpec } from "@/lib/tools/get-shopify-config";
import { spec as listShopifyDeliveryMethodsSpec } from "@/lib/tools/list-shopify-delivery-methods";
import { spec as listShopifyLocationsSpec } from "@/lib/tools/list-shopify-locations";
import { spec as updateShopifyConfigSpec } from "@/lib/tools/update-shopify-config";
import { spec as updateShopifyConnectionSpec } from "@/lib/tools/update-shopify-connection";
import { spec as setupShopifyCallbackSpec } from "@/lib/tools/setup-shopify-callback";

// Phase 2: WooCommerce integration (INTG-13/14/15/16/17/18).
import { spec as listWoocommerceConnectionsSpec } from "@/lib/tools/list-woocommerce-connections";
import { spec as getWoocommerceConfigSpec } from "@/lib/tools/get-woocommerce-config";
import { spec as listWoocommerceStatesSpec } from "@/lib/tools/list-woocommerce-states";
import { spec as listWoocommerceShippingLinesSpec } from "@/lib/tools/list-woocommerce-shipping-lines";
import { spec as setupWoocommerceConnectionSpec } from "@/lib/tools/setup-woocommerce-connection";
import { spec as upsertWoocommerceConfigSpec } from "@/lib/tools/upsert-woocommerce-config";

// Phase 2: Salla integration (INTG-20/21/23/24/25/26).
import { spec as installSallaSpec } from "@/lib/tools/install-salla";
import { spec as getSallaConnectionSpec } from "@/lib/tools/get-salla-connection";
import { spec as getSallaPlatformDataSpec } from "@/lib/tools/get-salla-platform-data";
import { spec as getSallaConfigSpec } from "@/lib/tools/get-salla-config";
import { spec as updateSallaConfigSpec } from "@/lib/tools/update-salla-config";
import { spec as toggleSallaFulfillmentSpec } from "@/lib/tools/toggle-salla-fulfillment";

// Phase 2: DESTRUCTIVE deletes (INTG-02, INTG-22) — confirm:true gated.
import { spec as deleteIntegrationSourceSpec } from "@/lib/tools/delete-integration-source";
import { spec as deleteSallaConnectionSpec } from "@/lib/tools/delete-salla-connection";

// M3 thin pass-through enabled writes.
// TODO(M4): cassette + output schemas + error mapping for these.
// TODO(M6): retroactive scope/audit/idempotency guardrails.
import { spec as createLastmileOrderSpec } from "@/lib/tools/create-lastmile-order";
import { spec as updateLastmileOrderSpec } from "@/lib/tools/update-lastmile-order";
import { spec as updateOrderWaypointSpec } from "@/lib/tools/update-order-waypoint";
import { spec as addParcelToOrderSpec } from "@/lib/tools/add-parcel-to-order";
import { spec as createFulfilmentOrderSpec } from "@/lib/tools/create-fulfilment-order";
import { spec as updateFulfilmentOrderSpec } from "@/lib/tools/update-fulfilment-order";
import { spec as createProductSpec } from "@/lib/tools/create-product";
import { spec as updateProductSpec } from "@/lib/tools/update-product";

// Disabled-pending-M6: registered for surface coverage; handler throws.
// Flip on at M6 with scope + audit + idempotency in place.
import { spec as markReadyForCollectionSpec } from "@/lib/tools/mark-ready-for-collection";
import { spec as cancelLastmileOrdersBatchSpec } from "@/lib/tools/cancel-lastmile-orders-batch";
import { spec as removeParcelFromOrderSpec } from "@/lib/tools/remove-parcel-from-order";
import { spec as adjustStockSpec } from "@/lib/tools/adjust-stock";
import { spec as bookInboundSlotSpec } from "@/lib/tools/book-inbound-slot";
import { spec as bulkValidateProductsSpec } from "@/lib/tools/bulk-validate-products";
import { spec as bulkCommitProductsSpec } from "@/lib/tools/bulk-commit-products";

// Phase 3 / Wave 1: Orders read path — Orders Core GraphQL family (ORDL-02/03).
import { spec as lookupOrdersIdsSpec } from "@/lib/tools/lookup-orders-ids";
import { spec as bulkOrdersLookupSpec } from "@/lib/tools/bulk-orders-lookup";

// Phase 3 / Wave 2: Orders read path — Quiqup REST history + Audit events (ORDS-02/05).
import { spec as getOrderHistorySpec } from "@/lib/tools/get-order-history";
import { spec as listOrderAuditEventsSpec } from "@/lib/tools/list-order-audit-events";

// Phase 3 / Wave 3: Orders read path — Platform reads (ORDL-04/05/06).
import { spec as findOrderByIdOrBarcodeSpec } from "@/lib/tools/find-order-by-id-or-barcode";
import { spec as listDepotsSpec } from "@/lib/tools/list-depots";
import { spec as listMissionsFilterSpec } from "@/lib/tools/list-missions-filter";

// Phase 3 / Wave 4: Orders read path — Ex-core CSV export + Orders Core REST multipart (ORDL-07/ORDS-08).
import { spec as downloadOrdersExportSpec } from "@/lib/tools/download-orders-export";
import { spec as uploadOrderDocumentSpec } from "@/lib/tools/upload-order-document";

// Staging-only state-machine helpers (Postman: Quiqup Staging State Change).
// Each pins `environment: z.literal("staging")` at the input schema, so any
// non-staging call is rejected by the validator before the handler runs.
import { spec as setOutForDeliveryBatchSpec } from "@/lib/tools/set-out-for-delivery-batch";
import { spec as setCollectionFailedBatchSpec } from "@/lib/tools/set-collection-failed-batch";
import { spec as setDeliveryFailedBatchSpec } from "@/lib/tools/set-delivery-failed-batch";

const handler = createMcpHandler(
  (server) => {
    // -- Legacy tools (own register*() functions per M1 audit) --
    registerClaimsDump(server);
    registerRecentOrders(server);

    // -- M2: hardened (cassette, output schema, error mapping) --
    registerTool(server, getLastmileOrderSpec);

    // -- Diagnostic for auth-vs-payload triage on platform-api --
    registerTool(server, whoamiPlatformSpec);

    // -- M3 reads: thin pass-through (TODO(M4) hardening) --
    registerTool(server, getLastmileOrderLabelSpec);
    registerTool(server, getFulfilmentOrderSpec);
    registerTool(server, listInventorySpec);
    registerTool(server, getInventoryBySkuSpec);
    registerTool(server, listSkuBatchesSpec);
    registerTool(server, getBatchSpec);
    registerTool(server, listInboundSlotsSpec);
    registerTool(server, listInboundsSpec);
    registerTool(server, getInboundSpec);
    registerTool(server, getInboundStateHistorySpec);
    registerTool(server, getInboundItemsSpec);
    registerTool(server, getProductBySkuSpec);

    // -- Phase 1: account + permissions reads --
    registerTool(server, getAccountSpec);
    registerTool(server, getPermissionsSpec);
    registerTool(server, getAccountCapabilitiesSpec);
    registerTool(server, getAccountByIdSpec);
    registerTool(server, getQuiqdashInitSpec);
    registerTool(server, listServiceKindsSpec);
    registerTool(server, listQuiqupOrderStatesSpec);

    // -- Phase 1: addresses, geo lookups, reason codes --
    registerTool(server, listAccountAddressesSpec);
    registerTool(server, createPartnerAddressSpec);
    registerTool(server, updatePartnerAddressSpec);
    registerTool(server, listCountriesSpec);
    registerTool(server, listCountryStatesSpec);
    registerTool(server, listCountryCitiesSpec);
    registerTool(server, listStateCitiesSpec);
    registerTool(server, lookupGooglePlaceSpec);
    registerTool(server, listPartnerCancellationReasonsSpec);
    registerTool(server, listOnHoldReasonsSpec);
    registerTool(server, listReturnToOriginReasonsSpec);
    registerTool(server, listCancellationReasonsSpec);
    registerTool(server, listCourierFailureReasonsSpec);

    // -- Phase 1: account + return-settings writes + feature flags --
    registerTool(server, updateAccountSpec);
    registerTool(server, decideFeatureFlagsBulkSpec);
    registerTool(server, getReturnSettingsSpec);
    registerTool(server, updateReturnSettingsSpec);
    registerTool(server, createAccountTeamMemberSpec);

    // -- Phase 2: shared integrations surface (INTG-01/03/04/05/06) --
    registerTool(server, listIntegrationConnectionsSpec);
    registerTool(server, listIntegrationOrderReasonsSpec);
    registerTool(server, repairIntegrationOrdersSpec);
    registerTool(server, getIntegrationOrderSpec);
    registerTool(server, confirmFfExportSpec);

    // -- Phase 2: Shopify integration (INTG-07/08/09/10/11/12) --
    registerTool(server, getShopifyConfigSpec);
    registerTool(server, listShopifyDeliveryMethodsSpec);
    registerTool(server, listShopifyLocationsSpec);
    registerTool(server, updateShopifyConfigSpec);
    registerTool(server, updateShopifyConnectionSpec);
    registerTool(server, setupShopifyCallbackSpec);

    // -- Phase 2: WooCommerce integration (INTG-13/14/15/16/17/18) --
    registerTool(server, listWoocommerceConnectionsSpec);
    registerTool(server, getWoocommerceConfigSpec);
    registerTool(server, listWoocommerceStatesSpec);
    registerTool(server, listWoocommerceShippingLinesSpec);
    registerTool(server, setupWoocommerceConnectionSpec);
    registerTool(server, upsertWoocommerceConfigSpec);

    // -- Phase 2: Salla integration (INTG-20/21/23/24/25/26) --
    registerTool(server, installSallaSpec);
    registerTool(server, getSallaConnectionSpec);
    registerTool(server, getSallaPlatformDataSpec);
    registerTool(server, getSallaConfigSpec);
    registerTool(server, updateSallaConfigSpec);
    registerTool(server, toggleSallaFulfillmentSpec);

    // -- Phase 2: DESTRUCTIVE deletes (INTG-02, INTG-22) — confirm:true gated --
    registerTool(server, deleteIntegrationSourceSpec);
    registerTool(server, deleteSallaConnectionSpec);

    // -- M3 enabled writes: thin pass-through (TODO(M4)/M6 hardening) --
    registerTool(server, createLastmileOrderSpec);
    registerTool(server, updateLastmileOrderSpec);
    registerTool(server, updateOrderWaypointSpec);
    registerTool(server, addParcelToOrderSpec);
    registerTool(server, createFulfilmentOrderSpec);
    registerTool(server, updateFulfilmentOrderSpec);
    registerTool(server, createProductSpec);
    registerTool(server, updateProductSpec);

    // -- Disabled pending M6 (scope/audit/idempotency) --
    registerTool(server, markReadyForCollectionSpec);
    registerTool(server, cancelLastmileOrdersBatchSpec);
    registerTool(server, removeParcelFromOrderSpec);
    registerTool(server, adjustStockSpec);
    registerTool(server, bookInboundSlotSpec);
    registerTool(server, bulkValidateProductsSpec);
    registerTool(server, bulkCommitProductsSpec);

    // -- Phase 3: Orders read path — Orders Core GraphQL family (ORDL-02/03) --
    registerTool(server, lookupOrdersIdsSpec);
    registerTool(server, bulkOrdersLookupSpec);

    // -- Phase 3: Orders read path — Quiqup REST history + Audit events (ORDS-02/05) --
    registerTool(server, getOrderHistorySpec);
    registerTool(server, listOrderAuditEventsSpec);

    // -- Phase 3: Orders read path — Platform reads (ORDL-04/05/06) --
    registerTool(server, findOrderByIdOrBarcodeSpec);
    registerTool(server, listDepotsSpec);
    registerTool(server, listMissionsFilterSpec);

    // -- Phase 3: Orders read path — Ex-core CSV export + Orders Core REST multipart (ORDL-07/ORDS-08) --
    registerTool(server, downloadOrdersExportSpec);
    registerTool(server, uploadOrderDocumentSpec);

    // -- Staging-only state-machine helpers (env pinned in the schema) --
    registerTool(server, setOutForDeliveryBatchSpec);
    registerTool(server, setCollectionFailedBatchSpec);
    registerTool(server, setDeliveryFailedBatchSpec);
  },
  {
    // SEP-973 `icons` on `Implementation` — Claude.ai's connector UI renders
    // this in the card. Requires `as any` because mcp-handler's typed
    // serverInfo hasn't been widened to the SDK's full Implementation yet;
    // the field passes through to the underlying MCP Server at runtime.
    serverInfo: {
      name: "Quiqup Orders",
      version: "0.1.0",
      icons: [
        {
          src: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/quiqup-logo.svg`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
        },
      ],
    } as never,
  },
  { basePath: "" },
);

const authHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined;

    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    if (!clerkAuth?.subject) return undefined;

    return {
      token: bearerToken,
      clientId: clerkAuth.clientId ?? "",
      scopes: clerkAuth.scopes ?? [],
      extra: { clerkAuth },
    };
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
);

export { authHandler as GET, authHandler as POST };
