import { beforeEach, describe, expect, it, vi } from 'vitest'

import { extractTextFromPdfBuffer } from '../document-text-extraction'

const { mockGetDocument } = vi.hoisted(() => ({
  mockGetDocument: vi.fn()
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument
}))

function fakePdfDocument(pagesText: string[]) {
  return {
    numPages: pagesText.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: pagesText[pageNumber - 1].split(' ').map((str) => ({ str }))
      })
    }))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractTextFromPdfBuffer', () => {
  it('joins text items within a page and pages with newlines', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(fakePdfDocument(['hello world', 'second page']))
    })

    const result = await extractTextFromPdfBuffer(Buffer.from('pdf bytes'))

    expect(result).toBe('hello world\nsecond page')
  })

  it('passes the buffer as a Uint8Array with worker/eval disabled', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(fakePdfDocument(['content']))
    })

    await extractTextFromPdfBuffer(Buffer.from('pdf bytes'))

    const callArgs = mockGetDocument.mock.calls[0][0]
    expect(callArgs.data).toBeInstanceOf(Uint8Array)
    expect(callArgs.useWorkerFetch).toBe(false)
    expect(callArgs.disableFontFace).toBe(true)
  })

  it('caps extraction at 20 pages', async () => {
    const pages = Array.from({ length: 25 }, (_, i) => `page${i + 1}`)
    const doc = fakePdfDocument(pages)
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(doc) })

    await extractTextFromPdfBuffer(Buffer.from('pdf bytes'))

    expect(doc.getPage).toHaveBeenCalledTimes(20)
  })

  it('truncates output at 15000 characters', async () => {
    const longWord = 'a'.repeat(20000)
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(fakePdfDocument([longWord]))
    })

    const result = await extractTextFromPdfBuffer(Buffer.from('pdf bytes'))

    expect(result).toHaveLength(15000)
  })

  it('throws a descriptive error when parsing fails', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('invalid PDF structure'))
    })

    await expect(
      extractTextFromPdfBuffer(Buffer.from('not a pdf'))
    ).rejects.toThrow(/invalid PDF structure/)
  })
})
