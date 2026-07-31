// Uses the "legacy" pdfjs-dist build (rather than the one PDFRenderer.tsx uses
// client-side via react-pdf) because this runs in a Node.js API route with no
// DOM/Worker globals - the legacy build runs pdf.js synchronously in-process
// instead of requiring a browser Worker.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_PAGES = 20
const MAX_CHARACTERS = 15000

export async function extractTextFromPdfBuffer(
  buffer: Buffer
): Promise<string> {
  let pdf
  try {
    pdf = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      disableFontFace: true
    }).promise
  } catch (error) {
    throw new Error(
      `Failed to parse PDF for text extraction: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }

  const pageCount = Math.min(pdf.numPages, MAX_PAGES)
  const pageTexts: string[] = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pageTexts.push(pageText)
  }

  return pageTexts.join('\n').trim().slice(0, MAX_CHARACTERS)
}
