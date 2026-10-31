import type { Dimension } from "./types.ts";

const scholarshipDimensions: Dimension[] = [
  {
    key: "eligibility",
    label: "Eligibility",
    importance: 5,
    why: "Confirm the applicant and program criteria that determine qualification.",
  },
  {
    key: "deadline",
    label: "Application deadline",
    importance: 5,
    why: "A missed deadline can prevent an otherwise eligible application.",
  },
  {
    key: "current_cycle",
    label: "Current academic cycle",
    importance: 5,
    why: "Confirm dates and requirements apply to the current award cycle.",
  },
  {
    key: "cost_and_fees",
    label: "Cost and fees",
    importance: 5,
    why: "Clarify award value, covered costs, and any application or participation fees.",
  },
  {
    key: "official_process",
    label: "Official application process",
    importance: 4,
    why: "Identify the authoritative application steps and required materials.",
  },
  {
    key: "renewal_and_continuation",
    label: "Renewal and continuation",
    importance: 4,
    why: "Check conditions for renewing or continuing the scholarship.",
  },
  {
    key: "exceptions",
    label: "Exceptions and special cases",
    importance: 3,
    why: "Find exceptions that may change eligibility or application requirements.",
  },
  {
    key: "contact_and_appeal",
    label: "Contact and appeal route",
    importance: 3,
    why: "Find how to resolve questions, report issues, or appeal a decision.",
  },
];

const generalFallbackDimensions: Dimension[] = [
  {
    key: "current_state",
    label: "Current status and timing",
    importance: 5,
    why: "Confirm that the information applies now and note relevant dates.",
  },
  {
    key: "eligibility_or_scope",
    label: "Eligibility and scope",
    importance: 5,
    why: "Identify who or what the requirements cover.",
  },
  {
    key: "costs_and_resources",
    label: "Costs and required resources",
    importance: 4,
    why: "Check fees, costs, and resources needed to proceed.",
  },
  {
    key: "official_process",
    label: "Official process and requirements",
    importance: 5,
    why: "Find the authoritative steps and required materials.",
  },
  {
    key: "exceptions_and_continuation",
    label: "Exceptions and continuation",
    importance: 3,
    why: "Check special cases, renewals, and continuing obligations.",
  },
  {
    key: "contact_and_appeal",
    label: "Contact and appeal route",
    importance: 3,
    why: "Find where to direct questions or challenge a decision.",
  },
];

export function isScholarshipQuestion(question: string): boolean {
  return /\b(scholarship|scholarships|fellowship|financial aid|student grant|education grant)\b/i.test(
    question,
  );
}

export function getFallbackDimensions(question: string): Dimension[] {
  return (isScholarshipQuestion(question)
    ? scholarshipDimensions
    : generalFallbackDimensions
  ).map((dimension) => ({ ...dimension }));
}
