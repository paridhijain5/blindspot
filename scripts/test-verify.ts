import assert from "node:assert/strict";
import { verifyQuote } from "../lib/verifyQuote.ts";

assert.equal(
  verifyQuote(
    "Applications close on June 30, 2025. Submit all documents online.",
    "Applications close on June 30, 2025.",
  ),
  true,
);
assert.equal(
  verifyQuote(
    "The award covers tuition — up to ₹50,000.",
    "The award covers tuition - up to ₹50,000.",
  ),
  true,
);
assert.equal(
  verifyQuote("The source concerns application forms.", "Rainfall totals in winter."),
  false,
);
assert.equal(verifyQuote("The source has no relevant wording.", ""), false);

console.log("Quote verification tests passed.");
