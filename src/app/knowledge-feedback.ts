import { knowledgeMissingReasonSchema, knowledgeVerificationReasonSchema } from "../lib/esp/contracts";
import { translate, type Locale } from "../lib/esp/locale";

export function knowledgeMissingMessage(reason: unknown, locale: Locale = "zh-CN") {
  const parsed = knowledgeMissingReasonSchema.safeParse(reason);
  return translate(locale, parsed.success ? `knowledgeMissing_${parsed.data}` : "knowledgeMissing_default");
}

export function knowledgeVerificationMessage(reason: unknown, locale: Locale = "zh-CN") {
  const parsed = knowledgeVerificationReasonSchema.safeParse(reason);
  return translate(locale, parsed.success ? `knowledgeVerification_${parsed.data}` : "knowledgeVerification_default");
}