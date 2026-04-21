import type { PromptDocument, PromptProseSection, PromptSection } from "../prompt-document";
import type { PromptSerializers } from "../prompt-format";
import { renderStructuredSection } from "./structured-section-renderer";

export function renderPromptDocument(
  document: PromptDocument,
  serializers?: PromptSerializers
): string {
  return document.sections.map((section) => renderPromptSection(section, serializers)).join("\n\n");
}

function renderPromptSection(section: PromptSection, serializers?: PromptSerializers): string {
  if (section.type === "prose") {
    return renderProseSection(section);
  }

  return renderStructuredSection(section, serializers);
}

function renderProseSection(section: PromptProseSection): string {
  if (!section.title) {
    return section.body;
  }

  return `## ${section.title}\n\n${section.body}`;
}
