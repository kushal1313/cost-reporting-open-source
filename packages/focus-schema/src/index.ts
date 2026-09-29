import { z } from "zod";

/**
 * Practical subset of the FinOps Open Cost and Usage Specification (FOCUS) 1.0
 * column set. Every connector normalizes provider-native billing data into this
 * shape so the rest of the system (storage, dashboard, budgets) is provider-agnostic.
 *
 * Full spec: https://focus.finops.org/
 */
export const ChargeCategory = z.enum(["Usage", "Purchase", "Tax", "Credit", "Adjustment"]);
export type ChargeCategory = z.infer<typeof ChargeCategory>;

export const ProviderName = z.enum([
  "AWS",
  "Azure",
  "GCP",
  "Datadog",
  "GrafanaCloud",
  "Snowflake",
  "Databricks",
]);
export type ProviderName = z.infer<typeof ProviderName>;

export const FocusRecordSchema = z.object({
  // Cost
  BilledCost: z.number(),
  EffectiveCost: z.number(),
  ListCost: z.number().optional(),
  BillingCurrency: z.string().length(3),

  // Time
  ChargePeriodStart: z.coerce.date(),
  ChargePeriodEnd: z.coerce.date(),
  BillingPeriodStart: z.coerce.date(),
  BillingPeriodEnd: z.coerce.date(),

  // Account hierarchy
  ProviderName,
  BillingAccountId: z.string(),
  BillingAccountName: z.string().optional(),
  SubAccountId: z.string().optional(),
  SubAccountName: z.string().optional(),

  // What was charged
  ServiceCategory: z.string(), // e.g. Compute, Storage, Observability, Analytics
  ServiceName: z.string(), // e.g. Amazon EC2, Datadog APM, Snowflake Compute
  ChargeCategory,
  ChargeDescription: z.string().optional(),

  // Usage
  PricingUnit: z.string().optional(),
  PricingQuantity: z.number().optional(),
  UsageUnit: z.string().optional(),
  UsageQuantity: z.number().optional(),

  // Location
  RegionId: z.string().optional(),
  RegionName: z.string().optional(),

  // Resource
  ResourceId: z.string().optional(),
  ResourceName: z.string().optional(),
  ResourceType: z.string().optional(),

  // Discounts / commitments
  CommitmentDiscountCategory: z.string().optional(), // e.g. Reserved, SavingsPlan, Committed Use

  // Freeform
  Tags: z.record(z.string()).default({}),
});
export type FocusRecord = z.infer<typeof FocusRecordSchema>;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface Scope {
  id: string;
  name: string;
  /** e.g. "account", "subscription", "project", "org" depending on provider */
  type: string;
}
