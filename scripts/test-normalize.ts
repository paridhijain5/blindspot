import assert from "node:assert/strict";
import { normalizeValue } from "../lib/normalize.ts";

assert.equal(normalizeValue("amount", "₹1.5 lakh"), "150000");
assert.equal(normalizeValue("amount", "Rs. 2 crore"), "20000000");
assert.equal(normalizeValue("amount", "$2.5k"), "2500");
assert.equal(normalizeValue("number", "1,250 applicants"), "1250");
assert.equal(normalizeValue("text", "  CURRENT   CYCLE "), "current cycle");
assert.equal(normalizeValue("date", "June 30, 2025"), "2025-06-30");
assert.equal(normalizeValue("amount", "no amount"), undefined);

console.log("Value normalization tests passed.");
