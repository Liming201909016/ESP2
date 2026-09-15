"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { KnowledgeDocument } from "../lib/esp/knowledge-corpus";
import { LanguageSelector, useLocale } from "./locale-provider";
import { libraryText } from "../lib/esp/knowledge-library-locale";

export function KnowledgeSourceView({ source }: { source: Pick<KnowledgeDocument, "id" | "title" | "organization" | "documentNumber" | "owner" | "dataKind" | "effectiveDate" | "version" | "section" | "content"> }) {
  const { locale, t } = useLocale();
  return <main className="knowledge-source">
    <header className="source-toolbar"><Link className="source-brand" href="/"><ArrowLeft size={16} />{t("sourceWorkbench")}</Link><LanguageSelector /></header>
    <article>
      <span className="sample-label">{t("sourceSynthetic")}</span>
      <h1>{source.title}</h1>
      <p>{source.organization}</p>
      <div className="source-metadata" role="group" aria-label={t("sourceMetadata")}>
        <span>{source.documentNumber}</span>
        <span>{libraryText(locale, "owner")}: {source.owner}</span>
        <span>{libraryText(locale, source.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")}: <time dateTime={source.effectiveDate}>{source.effectiveDate}</time></span>
        <span>{libraryText(locale, "version")} {source.version}</span>
        <span>{source.id}</span>
      </div>
      <h2>{source.section}</h2>
      <small>{t("reviewOriginal")}</small>
      <p className="source-content">{source.content}</p>
    </article>
  </main>;
}