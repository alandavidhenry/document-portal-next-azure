import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as generateQuestions } from '../admin/templates/[id]/generate-questions/route'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn()
}))
vi.mock('next-auth', () => ({ getServerSession: mockGetServerSession }))

const { mockGetById } = vi.hoisted(() => ({
  mockGetById: vi.fn()
}))
vi.mock('@/lib/document-templates', () => ({
  getDocumentTemplateById: mockGetById
}))

const { mockGetTemplateSourceText } = vi.hoisted(() => ({
  mockGetTemplateSourceText: vi.fn()
}))
vi.mock('@/lib/comprehension-question-source', () => ({
  getTemplateSourceText: mockGetTemplateSourceText
}))

const { mockGenerateComprehensionQuestions } = vi.hoisted(() => ({
  mockGenerateComprehensionQuestions: vi.fn()
}))
vi.mock('@/lib/comprehension-question-generation', () => ({
  generateComprehensionQuestions: mockGenerateComprehensionQuestions
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_SESSION = { user: { id: 'admin_1', roles: ['Tenant Admin'] } }
const NON_ADMIN_SESSION = { user: { roles: ['Customer User'] } }

const TEMPLATE = {
  id: 'template_123',
  title: 'Farmyard Safety Checklist',
  description: 'Covers tractors and livestock handling.',
  sourceType: 'form'
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function req(id: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/templates/${id}/generate-questions`,
    { method: 'POST' }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetById.mockResolvedValue(null)
})

describe('POST /api/admin/templates/[id]/generate-questions', () => {
  it('returns 403 when not an admin', async () => {
    mockGetServerSession.mockResolvedValue(NON_ADMIN_SESSION)
    const res = await generateQuestions(
      req('template_123'),
      params('template_123')
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when template not found', async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION)
    mockGetById.mockResolvedValue(null)
    const res = await generateQuestions(req('missing'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when source text cannot be derived', async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION)
    mockGetById.mockResolvedValue(TEMPLATE)
    mockGetTemplateSourceText.mockRejectedValue(
      new Error('Could not extract readable text from this document.')
    )
    const res = await generateQuestions(
      req('template_123'),
      params('template_123')
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Could not extract readable text/)
  })

  it('returns 500 when generation fails', async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION)
    mockGetById.mockResolvedValue(TEMPLATE)
    mockGetTemplateSourceText.mockResolvedValue('source text')
    mockGenerateComprehensionQuestions.mockRejectedValue(new Error('boom'))
    const res = await generateQuestions(
      req('template_123'),
      params('template_123')
    )
    expect(res.status).toBe(500)
  })

  it('returns 200 with the generated questions on success', async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION)
    mockGetById.mockResolvedValue(TEMPLATE)
    mockGetTemplateSourceText.mockResolvedValue('source text')
    const questions = [
      {
        id: 'q1',
        question: 'What must be worn?',
        options: ['PPE', 'Nothing'],
        answer: 'PPE'
      }
    ]
    mockGenerateComprehensionQuestions.mockResolvedValue(questions)

    const res = await generateQuestions(
      req('template_123'),
      params('template_123')
    )

    expect(res.status).toBe(200)
    expect((await res.json()).questions).toEqual(questions)
    expect(mockGetTemplateSourceText).toHaveBeenCalledWith(TEMPLATE)
    expect(mockGenerateComprehensionQuestions).toHaveBeenCalledWith(
      'source text'
    )
  })
})
