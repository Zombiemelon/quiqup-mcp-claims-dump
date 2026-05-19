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
