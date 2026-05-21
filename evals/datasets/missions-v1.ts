/**
 * missions-v1 — first eval dataset for the Phase-4 missions family
 * (MISS-01, MISS-02).
 *
 * Coverage:
 *   - create_mission        (MISS-01 — POST /quiqdash/missions, NOT destructive)
 *   - transfer_mission_orders (MISS-02 — PUT /quiqdash/missions/transfer/{id}, DESTRUCTIVE)
 *
 * The D-05 gating asymmetry — create=non-gated, transfer=destructive —
 * is locked at the schema layer by ../score-missions.ts via the
 * `gating-asymmetry-lock` STATIC scorer.
 *
 * Scored by ../score-missions.ts.
 */

export const TODAY = "2026-05-21";

export interface MissionsInput {
  request: string;
}

export type MissionsToolName = "create_mission" | "transfer_mission_orders";

export interface MissionsExpected {
  tool: MissionsToolName | MissionsToolName[];
  args: Record<string, unknown>;
}

export interface MissionsItem {
  input: MissionsInput;
  expectedOutput: MissionsExpected;
}

export const items: MissionsItem[] = [
  {
    input: {
      request:
        "Create a new delivery mission for depot 'DXB-DEPOT-1', zone 'DXB-MARINA', " +
        "type 'delivery', with initial orders 'o-1001' and 'o-1002'.",
    },
    expectedOutput: {
      tool: "create_mission",
      args: {
        depotId: "DXB-DEPOT-1",
        zone: "DXB-MARINA",
        type: "delivery",
        orderIds: ["o-1001", "o-1002"],
      },
    },
  },
  {
    input: {
      request:
        "Move orders 'o-2001', 'o-2002', 'o-2003' into mission 'miss-abc-123'. Confirmed.",
    },
    expectedOutput: {
      tool: "transfer_mission_orders",
      args: {
        mission_id: "miss-abc-123",
        order_ids: ["o-2001", "o-2002", "o-2003"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Set up a fresh collection mission for depot 'DXB-DEPOT-2', zone 'DXB-DEIRA-1', " +
        "type 'collection'. Initial order is 'o-3001'.",
    },
    expectedOutput: {
      tool: "create_mission",
      args: {
        depotId: "DXB-DEPOT-2",
        zone: "DXB-DEIRA-1",
        type: "collection",
        orderIds: ["o-3001"],
      },
    },
  },
  {
    input: {
      request:
        "Transfer the 5 backlog orders o-4001, o-4002, o-4003, o-4004, o-4005 into " +
        "mission 'miss-backlog-2026-05-21'. Use dry_run first so I can preview — yes confirm both.",
    },
    expectedOutput: {
      tool: "transfer_mission_orders",
      args: {
        mission_id: "miss-backlog-2026-05-21",
        order_ids: ["o-4001", "o-4002", "o-4003", "o-4004", "o-4005"],
        confirm: true,
        dry_run: true,
      },
    },
  },
];
