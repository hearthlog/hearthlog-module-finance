/**
 * Finance's persisted entities. Their names, tables, event prefixes, and
 * fields are deployed data contracts: never rename them.
 */

import type { EntityDefinition } from '@hearthlog/sdk/entities';

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
    {
        name: "asset",
        feature: "finance",
        table: "assets",
        fields: [
            {
                name: "name",
                type: "string",
                payloadKey: "name",
                required: true,
            },
            {
                name: "amount",
                type: "number",
                payloadKey: "amount",
                required: true,
            },
            {
                name: "asset_type",
                type: "string",
                payloadKey: "asset_type",
                default: "asset",
            },
        ],
        indexes: [{ name: "idx_assets_type", columns: ["asset_type"] }],
    },
    {
        name: "transaction",
        feature: "finance",
        table: "transactions",
        fields: [
            { name: "name", type: "string", payloadKey: "name" },
            {
                name: "amount",
                type: "number",
                payloadKey: "amount",
                required: true,
            },
            {
                name: "due_date",
                type: "datetime",
                payloadKey: "due_date",
                default: "datetime('now')",
            },
            {
                name: "transaction_status",
                type: "string",
                payloadKey: "transaction_status",
                default: "active",
            },
            {
                name: "transaction_category",
                type: "string",
                payloadKey: "transaction_category",
                default: "unknown",
            },
            // Where the category came from: `manual`, `history`, or `ai:<model>`.
            // Empty for rows saved before provenance was kept.
            {
                name: "category_source",
                type: "string",
                payloadKey: "category_source",
                default: "",
                optionalInPayload: true,
            },
        ],
        calendar: {
            key: "tx-due",
            dateField: "due_date",
            titleField: "name",
            subtitleField: "transaction_category",
            label: "Transaction due",
            presentation: { icon: "cash-clock", tone: "info", href: "/finance/{year}/{month}", rank: 30 },
            group: { id: "transactions", label: "Transactions", icon: "cash-clock" },
        },
        indexes: [
            {
                name: "idx_transactions_scope_due_date",
                columns: ["tenant_id", "log_id", "due_date"],
            },
            { name: "idx_transactions_due_date", columns: ["due_date"] },
            {
                name: "idx_transactions_status",
                columns: ["transaction_status"],
            },
        ],
    },
    {
        name: "budget_plan",
        feature: "finance",
        displayName: "Budget plan",
        table: "budget_plans",
        fields: [
            { name: "name", type: "string", required: true },
        ],
        indexes: [
            {
                name: "idx_budget_plans_scope_created",
                columns: ["tenant_id", "log_id", "created_at"],
            },
        ],
    },
    {
        name: "budget_item",
        feature: "finance",
        displayName: "Budget item",
        table: "budget_items",
        fields: [
            {
                name: "plan_id",
                type: "string",
                payloadKey: "planId",
                required: true,
            },
            { name: "name", type: "string", required: true },
            { name: "amount", type: "number", required: true },
            { name: "item_type", type: "string", payloadKey: "itemType", required: true },
            { name: "category", type: "string", default: "other" },
        ],
        indexes: [
            {
                name: "idx_budget_items_scope_plan_type",
                columns: ["tenant_id", "log_id", "plan_id", "item_type", "created_at"],
            },
        ],
    },
];
