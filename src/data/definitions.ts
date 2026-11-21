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
            // Linked accounts (bank sync). `manual` or `bank`; a bank asset's `amount` is written by the sync, in Kč.
            { name: "link", type: "string", payloadKey: "link", default: "manual", optionalInPayload: true },
            // `email`, `enable_banking` (later `fio`); empty for manual assets.
            { name: "provider", type: "string", payloadKey: "provider", default: "", optionalInPayload: true },
            // The `bank_connection` it came through.
            { name: "connection_id", type: "string", payloadKey: "connection_id", default: "", optionalInPayload: true },
            // Stable account key: the normalised IBAN, or the provider's identification hash.
            { name: "account_hash", type: "string", payloadKey: "account_hash", default: "", optionalInPayload: true },
            // `current`, `savings` or `card`; a card's amount is negative (what is owed).
            { name: "account_kind", type: "string", payloadKey: "account_kind", default: "", optionalInPayload: true },
            { name: "currency", type: "string", payloadKey: "currency", default: "CZK", optionalInPayload: true },
            // The balance in `currency` when it is not Kč.
            { name: "native_amount", type: "number", payloadKey: "native_amount", default: null, optionalInPayload: true },
            // The bank balance it shows (`ITAV`, `CLBD`, …) or `derived`.
            { name: "balance_type", type: "string", payloadKey: "balance_type", default: "", optionalInPayload: true },
            // `bank` when the provider states the balance, `derived` when Finance counts it from an anchor.
            { name: "balance_source", type: "string", payloadKey: "balance_source", default: "", optionalInPayload: true },
            // Derived balances: the last checked figure and when it was checked.
            { name: "anchor_amount", type: "number", payloadKey: "anchor_amount", default: null, optionalInPayload: true },
            { name: "anchor_at", type: "datetime", payloadKey: "anchor_at", default: null, optionalInPayload: true },
            // Last time the provider wrote this asset.
            { name: "synced_at", type: "datetime", payloadKey: "synced_at", default: null, optionalInPayload: true },
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
            // Bank rows (and plans tied to an account): the asset they belong to.
            { name: "asset_id", type: "string", payloadKey: "asset_id", default: "", optionalInPayload: true },
            // The provider's stable reference (`<bank>:<code>`, or the mail's message id); empty for hand-kept rows.
            { name: "bank_ref", type: "string", payloadKey: "bank_ref", default: "", optionalInPayload: true },
            // What the bank wrote; `name` starts as a cleaned copy and is the user's.
            { name: "bank_text", type: "string", payloadKey: "bank_text", default: "", optionalInPayload: true },
            { name: "counterparty", type: "string", payloadKey: "counterparty", default: "", optionalInPayload: true },
            // `new` until the user has looked at a bank row, then `reviewed`; empty for hand-kept rows.
            { name: "review", type: "string", payloadKey: "review", default: "", optionalInPayload: true },
            // A bank row's suggested plan. While set, that plan looks paid and leaves the forecast.
            { name: "plan_match", type: "string", payloadKey: "plan_match", default: "", optionalInPayload: true },
            // Both rows of a move between own accounts share it; their category is `transfer`.
            { name: "transfer_id", type: "string", payloadKey: "transfer_id", default: "", optionalInPayload: true },
            // Amount in `native_currency` when the row was not in Kč.
            { name: "native_amount", type: "number", payloadKey: "native_amount", default: null, optionalInPayload: true },
            { name: "native_currency", type: "string", payloadKey: "native_currency", default: "", optionalInPayload: true },
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
            { name: "idx_transactions_plan_match", columns: ["tenant_id", "log_id", "plan_match"] },
            { name: "idx_transactions_bank_ref", columns: ["tenant_id", "log_id", "bank_ref"] },
        ],
    },
    {
        // One link to one bank through one provider (a mailbox rule, a consent, a token). Holds no credential.
        name: "bank_connection",
        feature: "finance",
        displayName: "Bank connection",
        table: "bank_connections",
        fields: [
            { name: "bank", type: "string", payloadKey: "bank", required: true },
            { name: "provider", type: "string", payloadKey: "provider", required: true },
            { name: "country", type: "string", payloadKey: "country", default: "CZ" },
            // Consent expiry (Enable Banking); empty for providers without one.
            { name: "valid_until", type: "datetime", payloadKey: "valid_until", default: null },
            // `active`, `expired`, `error` or `revoked`.
            { name: "status", type: "string", payloadKey: "status", default: "active" },
            { name: "last_sync_at", type: "datetime", payloadKey: "last_sync_at", default: null },
            { name: "last_error", type: "string", payloadKey: "last_error", default: "" },
        ],
        indexes: [
            { name: "idx_bank_connections_scope", columns: ["tenant_id", "log_id", "created_at"] },
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
