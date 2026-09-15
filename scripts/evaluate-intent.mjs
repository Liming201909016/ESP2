import assert from "node:assert/strict";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3100");
const writeTicket = process.argv.includes("--ticket-lifecycle");

async function ask(query, options = {}) {
  const response = await fetch(new URL("/api/route", baseUrl), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, ...options }), redirect: "manual",
    signal: AbortSignal.timeout(65_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${body.error ?? "Request failed"} (${response.status}, ${body.requestId ?? "no request ID"})`);
  return body;
}

const cases = [
  {
    name: "paraphrase-travel",
    run: async () => {
      const result = await ask("北京住一晚最多能花多少钱？");
      assert.equal(result.intent.source, "model");
      assert.equal(result.route.skill?.id, "search-expense-policy");
      assert.equal(result.executionStatus, "completed");
      assert.equal(result.execution.type, "knowledge_answer");
      assert.match(result.execution.answer, /600/);
    },
  },
  {
    name: "paraphrase-ticket-draft",
    run: async () => {
      const query = "电脑开不了机，需要IT帮忙，仅我一人受影响，设备SIM-LT-0042。";
      const result = await ask(query);
      assert.equal(result.route.skill?.id, "create-it-ticket");
      assert.equal(result.route.requiresConfirmation, true);
      assert.equal(result.executionStatus, "waiting_confirmation");
      assert.equal(result.execution, null);
      assert.equal(result.intent.parameters.impact, "individual");
      assert.ok(result.intent.parameters.description?.length >= 3);
      assert.ok(query.includes(result.intent.parameters.description));
    },
  },
  {
    name: "missing-fields",
    run: async () => {
      const result = await ask("创建工单");
      assert.equal(result.executionStatus, "needs_input");
      assert.equal(result.execution.type, "ticket_details_required");
      assert.deepEqual(result.execution.missingFields, ["description", "impact"]);
    },
  },
  {
    name: "ambiguous-request-and-selection",
    run: async () => {
      const query = "我想了解年假制度和报销要求，请先让我选择这次要办理哪个事项。";
      const result = await ask(query);
      assert.equal(result.executionStatus, "needs_input");
      assert.equal(result.execution.type, "intent_clarification");
      const ids = result.execution.choices.map((choice) => choice.id);
      assert.ok(ids.includes("search-company-policy") && ids.includes("search-expense-policy"));
      const selected = await ask(query, { selectedSkillId: "search-company-policy" });
      assert.equal(selected.intent.source, "selection");
      assert.equal(selected.route.skill?.id, "search-company-policy");
      assert.equal(selected.executionStatus, "completed");
      assert.ok(selected.execution.citations.every((citation) => citation.documentNumber.startsWith("SIM-HR-")));
      assert.match(selected.execution.answer, /(?:\d+|申请|审批|结转|工作日)/u, "Selection must return policy facts, not just acknowledge the chosen domain");
      const expense = await ask(query, { selectedSkillId: "search-expense-policy" });
      assert.equal(expense.executionStatus, "completed");
      assert.ok(expense.execution.citations.every((citation) => citation.documentNumber.startsWith("SIM-FIN-")));
      assert.match(expense.execution.answer, /(?:凭证|发票|收据|30\s*个?\s*自然日|财务复核)/u, "Expense selection must answer the original requirements question");
    },
  },
  {
    name: "unrelated-request",
    run: async () => {
      const result = await ask("给我写一首关于月亮的诗");
      assert.equal(result.executionStatus, "not_routed");
      assert.equal(result.execution, null);
    },
  },
  {
    name: "form-input-is-retained",
    run: async () => {
      const parameters = { description: "VPN cannot connect for one user", impact: "individual", device: "SIM-LT-0042" };
      const missing = await ask("请帮助处理", { selectedSkillId: "create-it-ticket", parameters: { description: parameters.description } });
      assert.equal(missing.executionStatus, "needs_input");
      assert.deepEqual(missing.execution.missingFields, ["impact"]);
      const preview = await ask("请帮助处理", { selectedSkillId: "create-it-ticket", parameters });
      assert.equal(preview.executionStatus, "waiting_confirmation");
      assert.deepEqual(preview.intent.parameters, parameters);
      assert.equal(preview.intent.source, "selection");
      assert.equal(preview.execution, null);

      if (writeTicket) {
        assert.ok(preview.confirmation?.id, "Server confirmation is required");
        const created = await ask("请帮助处理", { selectedSkillId: "create-it-ticket", parameters, confirmed: true, confirmationId: preview.confirmation.id });
        assert.equal(created.executionStatus, "completed");
        assert.equal(created.execution.type, "ticket_created");
        const ticket = created.execution.ticket;
        assert.deepEqual(ticket.details, parameters);
        const lookup = await ask(`ticket status ${ticket.id}`);
        assert.equal(lookup.execution.type, "ticket_status");
        assert.deepEqual(lookup.execution.ticket.details, parameters);
        console.log(`Structured ticket saved and retrieved: ${ticket.id}`);
      }
    },
  },
];

let failed = 0;
for (const testCase of cases) {
  try {
    await testCase.run();
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
console.log(`Intent evaluation: ${cases.length - failed}/${cases.length} passed`);
if (failed) process.exitCode = 1;