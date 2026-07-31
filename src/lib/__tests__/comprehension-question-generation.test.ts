import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateComprehensionQuestions } from '../comprehension-question-generation'

function mockChatCompletion(content: unknown) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }]
    })
  }
}

beforeEach(() => {
  process.env.AI_FOUNDRY_ENDPOINT =
    'https://aif-minato-dev-uks.openai.azure.com'
  process.env.AI_FOUNDRY_KEY = 'fake-key'
  process.env.AI_FOUNDRY_DEPLOYMENT_NAME = 'comprehension-questions'
})

afterEach(() => {
  delete process.env.AI_FOUNDRY_ENDPOINT
  delete process.env.AI_FOUNDRY_KEY
  delete process.env.AI_FOUNDRY_DEPLOYMENT_NAME
  delete process.env.AI_FOUNDRY_API_VERSION
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('generateComprehensionQuestions', () => {
  it('throws when required env vars are not configured', async () => {
    delete process.env.AI_FOUNDRY_ENDPOINT

    await expect(generateComprehensionQuestions('some text')).rejects.toThrow(
      'AI_FOUNDRY_ENDPOINT'
    )
  })

  it('posts to the deployment chat-completions endpoint with the api-key header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockChatCompletion({
        questions: [
          {
            question: 'What is required?',
            options: ['PPE', 'Nothing'],
            answer: 'PPE'
          }
        ]
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await generateComprehensionQuestions('document text', 1)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://aif-minato-dev-uks.openai.azure.com/openai/deployments/comprehension-questions/chat/completions?api-version=2024-10-21'
    )
    expect(init.headers['api-key']).toBe('fake-key')
    const body = JSON.parse(init.body)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('uses a custom AI_FOUNDRY_API_VERSION when provided', async () => {
    process.env.AI_FOUNDRY_API_VERSION = '2025-01-01-preview'
    const mockFetch = vi.fn().mockResolvedValue(
      mockChatCompletion({
        questions: [{ question: 'Q1?', options: ['A', 'B'], answer: 'A' }]
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await generateComprehensionQuestions('text')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('api-version=2025-01-01-preview')
  })

  it('returns validated questions with generated ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockChatCompletion({
          questions: [
            {
              question: 'What must be worn in the workshop?',
              options: ['Safety goggles', 'Sandals', 'Nothing', 'A hat'],
              answer: 'Safety goggles'
            }
          ]
        })
      )
    )

    const result = await generateComprehensionQuestions('text', 1)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      question: 'What must be worn in the workshop?',
      options: ['Safety goggles', 'Sandals', 'Nothing', 'A hat'],
      answer: 'Safety goggles'
    })
    expect(typeof result[0].id).toBe('string')
    expect(result[0].id.length).toBeGreaterThan(0)
  })

  it('filters out a question whose answer is not one of its options', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockChatCompletion({
          questions: [
            { question: 'Bad question', options: ['A', 'B'], answer: 'C' },
            { question: 'Good question', options: ['A', 'B'], answer: 'A' }
          ]
        })
      )
    )

    const result = await generateComprehensionQuestions('text', 2)

    expect(result).toHaveLength(1)
    expect(result[0].question).toBe('Good question')
  })

  it('filters out a question with fewer than 2 non-empty unique options', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockChatCompletion({
          questions: [
            { question: 'Only one option', options: ['A', ''], answer: 'A' },
            { question: 'Duplicate options', options: ['A', 'A'], answer: 'A' }
          ]
        })
      )
    )

    await expect(generateComprehensionQuestions('text', 2)).rejects.toThrow(
      /did not return any usable questions/
    )
  })

  it('throws when every generated question is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockChatCompletion({ questions: [] }))
    )

    await expect(generateComprehensionQuestions('text')).rejects.toThrow(
      /did not return any usable questions/
    )
  })

  it('throws a descriptive error on a non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'rate limited'
      })
    )

    await expect(generateComprehensionQuestions('text')).rejects.toThrow(/429/)
  })

  it('throws when the model response content is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'not json' } }]
        })
      })
    )

    await expect(generateComprehensionQuestions('text')).rejects.toThrow(
      /not valid JSON/
    )
  })
})
