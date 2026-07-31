import type { DocumentTemplateData } from '@/lib/document-templates'
import { extractTextFromPdfBuffer } from '@/lib/document-text-extraction'
import { downloadBlob } from '@/lib/storage'

const MIN_EXTRACTED_TEXT_LENGTH = 20

export async function getTemplateSourceText(
  template: DocumentTemplateData
): Promise<string> {
  if (template.sourceType === 'upload') {
    if (!template.sourceDocBlobPath) {
      throw new Error(
        'This template has no uploaded source document to generate questions from.'
      )
    }

    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!
    const buffer = await downloadBlob(containerName, template.sourceDocBlobPath)
    const text = await extractTextFromPdfBuffer(buffer)

    if (text.trim().length < MIN_EXTRACTED_TEXT_LENGTH) {
      throw new Error(
        'Could not extract readable text from this document — it may be a scanned image with no text layer.'
      )
    }

    return text
  }

  const fieldLabels = (template.formSchema ?? [])
    .filter((field) => field.type !== 'section')
    .map((field) => field.label)
    .filter((label) => label.trim().length > 0)

  const parts = [
    template.title,
    template.description ?? '',
    ...fieldLabels
  ].filter((part) => part.trim().length > 0)

  return parts.join('\n')
}
