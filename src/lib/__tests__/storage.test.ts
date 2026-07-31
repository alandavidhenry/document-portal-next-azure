import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob, generateSasToken, uploadBlob } from '../storage'

const { mockBlobClient, mockBlockBlobClient, mockContainerClient } = vi.hoisted(
  () => {
    const mockBlobClient = {
      generateSasUrl: vi.fn()
    }
    const mockBlockBlobClient = {
      uploadData: vi.fn(),
      downloadToBuffer: vi.fn()
    }
    const mockContainerClient = {
      getBlobClient: vi.fn(() => mockBlobClient),
      getBlockBlobClient: vi.fn(() => mockBlockBlobClient)
    }
    return { mockBlobClient, mockBlockBlobClient, mockContainerClient }
  }
)

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: vi.fn(() => ({
      getContainerClient: vi.fn(() => mockContainerClient)
    }))
  },
  BlobSASPermissions: {
    parse: vi.fn(() => ({ read: true }))
  },
  SASProtocol: {
    Https: 'Https'
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true'
  mockBlobClient.generateSasUrl.mockResolvedValue(
    'https://mock.blob.core.windows.net/container/file?sas=token'
  )
})

describe('generateSasToken', () => {
  it('calls generateSasUrl and returns the SAS URL', async () => {
    const url = await generateSasToken('my-container', 'folder/report.pdf', {
      permissions: 'r'
    })

    expect(url).toBe(
      'https://mock.blob.core.windows.net/container/file?sas=token'
    )
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith(
      'folder/report.pdf'
    )
    expect(mockBlobClient.generateSasUrl).toHaveBeenCalledOnce()
  })

  it('passes a custom expiresOn when provided', async () => {
    const expiresOn = new Date('2030-01-01')
    await generateSasToken('my-container', 'file.pdf', {
      permissions: 'rw',
      expiresOn
    })

    const sasArgs = mockBlobClient.generateSasUrl.mock.calls[0][0]
    expect(sasArgs.expiresOn).toBe(expiresOn)
  })

  it('uses a default 30-minute expiry when expiresOn is not provided', async () => {
    const before = Date.now()
    await generateSasToken('my-container', 'file.pdf', { permissions: 'r' })
    const after = Date.now()

    const sasArgs = mockBlobClient.generateSasUrl.mock.calls[0][0]
    const expiresMs = sasArgs.expiresOn.getTime()
    expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000)
    expect(expiresMs).toBeLessThanOrEqual(after + 30 * 60 * 1000)
  })
})

describe('uploadBlob', () => {
  it('uploads the buffer with the given content type', async () => {
    mockBlockBlobClient.uploadData.mockResolvedValue({})

    await uploadBlob(
      'my-container',
      'templates/template_123/source.pdf',
      Buffer.from('pdf bytes'),
      'application/pdf'
    )

    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
      'templates/template_123/source.pdf'
    )
    expect(mockBlockBlobClient.uploadData).toHaveBeenCalledWith(
      Buffer.from('pdf bytes'),
      { blobHTTPHeaders: { blobContentType: 'application/pdf' } }
    )
  })
})

describe('downloadBlob', () => {
  it('downloads the blob and returns the buffer', async () => {
    const buffer = Buffer.from('pdf bytes')
    mockBlockBlobClient.downloadToBuffer.mockResolvedValue(buffer)

    const result = await downloadBlob(
      'my-container',
      'templates/template_123/source.pdf'
    )

    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
      'templates/template_123/source.pdf'
    )
    expect(result).toBe(buffer)
  })
})
