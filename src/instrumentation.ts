export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ESP_FINANCE_KNOWLEDGE_BOOTSTRAP === "true") {
    if (process.env.ESP_ENVIRONMENT !== "dev" || process.env.ESP_FINANCE_KNOWLEDGE_ENABLED !== "true") throw new Error("FINANCE_KNOWLEDGE_BOOTSTRAP_NOT_ALLOWED");
    const { runKnowledgeIndex } = await import("../scripts/index-knowledge.mjs");
    const { knowledgeDocuments } = await import("./lib/esp/knowledge-corpus");
    try {
      const result = await runKnowledgeIndex(["--finance"], { documents: knowledgeDocuments });
      console.info("knowledge.finance.initialized", result);
    } catch (error) {
      console.error("knowledge.finance.initialization.failed", {
        statusCode: typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined,
      });
      throw new Error("FINANCE_KNOWLEDGE_INITIALIZATION_FAILED");
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.ESP_STATE_MIGRATE || process.env.ESP_STATE_BACKEND === "postgres")) {
    const { migrateBlobState, requirePreparedPostgres } = await import("./lib/esp/state-migration");
    try {
      if (process.env.ESP_STATE_MIGRATE) {
        const report = await migrateBlobState();
        console.info("state.migration.completed", report);
      }
      if (process.env.ESP_STATE_BACKEND === "postgres") await requirePreparedPostgres();
    } catch (error) {
      const code = error instanceof Error && /^(?:STATE_|POSTGRES_)[A-Z0-9_]+(?::[a-z,]+)?$/.test(error.message) ? error.message : "STATE_INITIALIZATION_FAILED";
      console.error("state.initialization.failed", {
        code,
        sqlState: typeof error === "object" && error !== null && "sqlState" in error ? error.sqlState : undefined,
        secretStatus: typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined,
      });
      throw new Error(code);
    }
  }
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.ESP_ENVIRONMENT === "dev" &&
    process.env.ESP_KNOWLEDGE_SEED === "true"
  ) {
    const { seedKnowledgeSamples } = await import("./lib/esp/knowledge-search");
    try {
      const count = await seedKnowledgeSamples();
      console.info("knowledge.samples.indexed", { count });
    } catch (error) {
      console.error("knowledge.samples.failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        statusCode: typeof error === "object" && error && "statusCode" in error ? error.statusCode : undefined,
      });
      throw new Error("KNOWLEDGE_SEED_VERIFICATION_FAILED");
    }
  }
}