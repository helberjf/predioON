import { takeLoginBudget } from "../../src/auth/login-budget.js";
import { closeIdentityDb } from "@predioon/db/identity";

// A separate process has no shared JavaScript state with its parent test.
try {
  const email = process.env.TEST_LOGIN_BUDGET_EMAIL;
  if (!email) throw new Error("Missing isolated test identity");
  console.log(JSON.stringify({ retryAfter: await takeLoginBudget(email, "127.0.0.1") }));
} finally {
  await closeIdentityDb();
}
