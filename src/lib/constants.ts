export const DRAWING_CATEGORIES = ["Architectural", "Ceiling", "Electrical", "HVAC", "Plumbing", "Joinery"] as const;

export const DOCUMENT_CATEGORIES = [
  "Contracts",
  "Drawings",
  "BOQ",
  "Pricing",
  "Specifications",
  "Approvals",
  "Reports",
  "Other",
] as const;

export const BOQ_CATEGORIES = [
  "Flooring",
  "Walls",
  "Ceiling",
  "Paint",
  "Gypsum",
  "Joinery",
  "Doors",
  "Windows",
  "Sanitary",
  "Lighting",
  "Electrical",
  "HVAC",
  "Furniture",
  "Accessories",
  "Other",
] as const;

export const MATERIAL_CATEGORIES = ["Marble", "Wood", "Fabric", "Paint", "Metal", "Lighting", "Tiles", "Other"] as const;

export const PRICING_CATEGORIES = ["Interior Works", "Electrical", "HVAC", "Joinery", "Furniture", "Other"] as const;

export const PROJECT_STAGES = [
  { value: "CONCEPT", label: "Concept" },
  { value: "DESIGN", label: "Design Development" },
  { value: "VISUALIZATION", label: "3D Visualization" },
  { value: "TECHNICAL_DRAWINGS", label: "Technical Drawings" },
  { value: "BOQ", label: "BOQ" },
  { value: "PRICING", label: "Execution Pricing" },
  { value: "APPROVAL", label: "Final Approval" },
  { value: "HANDOVER", label: "Handover" },
] as const;

export const PIPELINE_STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "INTERNAL_REVIEW", label: "Internal Review" },
  { value: "SENT_TO_CLIENT", label: "Sent to Client" },
  { value: "CLIENT_REVIEWING", label: "Client Reviewing" },
  { value: "CHANGES_REQUESTED", label: "Changes Requested" },
  { value: "APPROVED", label: "Approved" },
  { value: "EXECUTION", label: "Execution" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

export const HOTSPOT_CATEGORIES = ["Material", "Furniture", "Lighting", "Drawing", "Note"] as const;

export function toOptions(values: readonly string[]) {
  return values.map((v) => ({ value: v, label: v }));
}
