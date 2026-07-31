import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTemplateSourceText } from '../comprehension-question-source'

import type { DocumentTemplateData } from '../document-templates'

const { mockDownloadBlob, mockExtractTextFromPdfBuffer } = vi.hoisted(() => ({
  mockDownloadBlob: vi.fn(),
  mockExtractTextFromPdfBuffer: vi.fn()
}))

vi.mock('@/lib/storage', () => ({
  downloadBlob: mockDownloadBlob
}))

vi.mock('@/lib/document-text-extraction', () => ({
  extractTextFromPdfBuffer: mockExtractTextFromPdfBuffer
}))

function baseTemplate(
  overrides: Partial<DocumentTemplateData> = {}
): DocumentTemplateData {
  return {
    id: 'template_1',
    title: 'Fire Safety Policy',
    description: 'Covers fire exits and assembly points.',
    blobPath: null,
    formSchema: null,
    questions: null,
    version: 1,
    tenantId: null,
    ownerCompanyId: null,
    category: 'Fire Safety',
    sourceType: 'form',
    uploadMode: null,
    sourceDocBlobPath: null,
    sourceDocOriginalBlobPath: null,
    sourceDocFileName: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AZURE_STORAGE_CONTAINER_NAME = 'documents'
})

describe('getTemplateSourceText — form templates', () => {
  it('combines title, description, and non-section field labels', async () => {
    const template = baseTemplate({
      formSchema: [
        {
          id: 'f1',
          label: 'Are fire exits clear?',
          type: 'checkbox',
          required: true
        },
        {
          id: 'f2',
          label: 'Emergency procedures',
          type: 'section',
          required: false
        },
        {
          id: 'f3',
          label: 'Assembly point location',
          type: 'text',
          required: true
        }
      ]
    })

    const text = await getTemplateSourceText(template)

    expect(text).toContain('Fire Safety Policy')
    expect(text).toContain('Covers fire exits and assembly points.')
    expect(text).toContain('Are fire exits clear?')
    expect(text).toContain('Assembly point location')
    expect(text).not.toContain('Emergency procedures')
  })

  it('omits a null description and empty formSchema without error', async () => {
    const template = baseTemplate({ description: null, formSchema: [] })

    const text = await getTemplateSourceText(template)

    expect(text).toBe('Fire Safety Policy')
  })
})

describe('getTemplateSourceText — upload templates', () => {
  it('downloads the blob and extracts text', async () => {
    const template = baseTemplate({
      sourceType: 'upload',
      sourceDocBlobPath: 'templates/template_1/source.pdf'
    })
    mockDownloadBlob.mockResolvedValue(Buffer.from('pdf bytes'))
    mockExtractTextFromPdfBuffer.mockResolvedValue(
      'This is a long enough extracted document body of text.'
    )

    const text = await getTemplateSourceText(template)

    expect(mockDownloadBlob).toHaveBeenCalledWith(
      'documents',
      'templates/template_1/source.pdf'
    )
    expect(text).toBe('This is a long enough extracted document body of text.')
  })

  it('throws when the template has no source document blob path', async () => {
    const template = baseTemplate({
      sourceType: 'upload',
      sourceDocBlobPath: null
    })

    await expect(getTemplateSourceText(template)).rejects.toThrow(
      /no uploaded source document/
    )
  })

  it('throws when extracted text is too short (e.g. a scanned image PDF)', async () => {
    const template = baseTemplate({
      sourceType: 'upload',
      sourceDocBlobPath: 'templates/template_1/source.pdf'
    })
    mockDownloadBlob.mockResolvedValue(Buffer.from('pdf bytes'))
    mockExtractTextFromPdfBuffer.mockResolvedValue('  ')

    await expect(getTemplateSourceText(template)).rejects.toThrow(
      /Could not extract readable text/
    )
  })
})
