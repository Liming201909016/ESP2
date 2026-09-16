import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDocsDriftContract } from "./docs-drift-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const contract = JSON.parse(readFileSync(resolve(root, "docs", "drift-contract.json"), "utf8"));
validateDocsDriftContract(contract, (path) => readFileSync(resolve(root, path), "utf8"));
console.log(`documentation drift: ${contract.contracts.length} behavior contracts valid`);
