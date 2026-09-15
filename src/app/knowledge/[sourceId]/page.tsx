import { notFound } from "next/navigation";
import { publishedKnowledgeSource } from "../../../lib/esp/knowledge-evidence";
import { KnowledgeSourceView } from "../../knowledge-source";

export const dynamic = "force-dynamic";

export default async function KnowledgeSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const source = await publishedKnowledgeSource(sourceId);
  if (!source) notFound();

  return <KnowledgeSourceView source={source} />;
}