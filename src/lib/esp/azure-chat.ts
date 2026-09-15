import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";

let client: AzureOpenAI | undefined;

export function azureChat() {
  const endpoint = process.env.AZURE_AI_ENDPOINT;
  const deployment = process.env.AZURE_AI_CHAT_DEPLOYMENT;
  if (!endpoint || !deployment) throw new Error("Azure AI chat configuration is missing");
  client ??= new AzureOpenAI({
    endpoint,
    deployment,
    apiVersion: "2024-10-21",
    azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"),
    timeout: 20_000,
    maxRetries: 1,
  });
  return { client, deployment };
}