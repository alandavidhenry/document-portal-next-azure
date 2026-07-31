import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol
} from '@azure/storage-blob'

interface SasTokenOptions {
  permissions: string
  startsOn?: Date
  expiresOn?: Date
  contentDisposition?: string
}

export async function uploadBlob(
  containerName: string,
  blobName: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(blobName)
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType }
  })
}

export async function downloadBlob(
  containerName: string,
  blobName: string
): Promise<Buffer> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(blobName)
  return blockBlobClient.downloadToBuffer()
}

export async function deleteBlob(
  containerName: string,
  blobName: string
): Promise<void> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  await containerClient.getBlobClient(blobName).deleteIfExists()
}

export async function generateSasToken(
  containerName: string,
  blobName: string,
  options: SasTokenOptions
) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blobClient = containerClient.getBlobClient(blobName)

  // Back-date startsOn by 5 minutes to absorb clock skew between the app
  // server and Azure Storage — without this, a few seconds of drift causes
  // Azure to reject the token as "not yet valid".
  const startsOn = options.startsOn ?? new Date(Date.now() - 5 * 60 * 1000)

  return blobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse(options.permissions),
    startsOn,
    expiresOn: options.expiresOn ?? new Date(Date.now() + 30 * 60 * 1000),
    protocol: SASProtocol.Https,
    contentDisposition: options.contentDisposition
  })
}
