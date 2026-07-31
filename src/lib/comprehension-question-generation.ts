// src/lib/comprehension-question-generation.ts
// Calls the Azure AI Foundry model deployment (see
// infrastructure/modules/ai_foundry/) to draft candidate comprehension
// questions from a template's source text. Generated questions are never
// persisted directly - the caller returns them to the admin as suggestions,
// which are only saved once the admin reviews/edits and clicks Save/Publish
// through the existing template-editing flow (human-review gate).
import type { ComprehensionQuestion } from '@/types/comprehension-question'

const DEFAULT_API_VERSION = '2024-10-21'
const DEFAULT_QUESTION_COUNT = 3

interface RawGeneratedQuestion {
  question?: unknown
  options?: unknown
  answer?: unknown
}

function normalizeQuestion(
  raw: RawGeneratedQuestion
): { question: string; options: string[]; answer: string } | null {
  if (typeof raw.question !== 'string' || raw.question.trim().length === 0) {
    return null
  }
  if (!Array.isArray(raw.options)) return null

  const options = raw.options
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
  const uniqueOptions = new Set(options)

  if (uniqueOptions.size < 2 || uniqueOptions.size !== options.length) {
    return null
  }
  if (typeof raw.answer !== 'string') return null

  const answer = raw.answer.trim()
  if (!options.includes(answer)) return null

  return { question: raw.question.trim(), options, answer }
}

function buildPrompt(sourceText: string, count: number): string {
  return (
    `You are generating comprehension-check questions for a workplace health & safety document. ` +
    `Read the document text below and produce exactly ${count} multiple-choice questions that verify a reader ` +
    `has understood key, safety-relevant points. Each question must have exactly 4 answer options, with exactly ` +
    `one correct answer that is a verbatim copy of one of the options. Questions and options must be grounded ` +
    `strictly in the provided text - do not invent facts not present in it.\n\n` +
    `Respond with ONLY a JSON object of the form ` +
    `{"questions": [{"question": string, "options": string[4], "answer": string}]}, no markdown fencing.\n\n` +
    `Document text:\n"""\n${sourceText}\n"""`
  )
}

export async function generateComprehensionQuestions(
  sourceText: string,
  count: number = DEFAULT_QUESTION_COUNT
): Promise<ComprehensionQuestion[]> {
  const endpoint = process.env.AI_FOUNDRY_ENDPOINT
  const apiKey = process.env.AI_FOUNDRY_KEY
  const deploymentName = process.env.AI_FOUNDRY_DEPLOYMENT_NAME
  if (!endpoint || !apiKey || !deploymentName) {
    throw new Error(
      'AI_FOUNDRY_ENDPOINT, AI_FOUNDRY_KEY, and AI_FOUNDRY_DEPLOYMENT_NAME must be configured to generate comprehension questions.'
    )
  }
  const apiVersion = process.env.AI_FOUNDRY_API_VERSION ?? DEFAULT_API_VERSION

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You write concise, accurate multiple-choice comprehension questions for health & safety documents.'
        },
        { role: 'user', content: buildPrompt(sourceText, count) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Comprehension question generation failed (${response.status} ${response.statusText})` +
        (detail ? `: ${detail}` : '')
    )
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(
      'Comprehension question generation failed: model returned no content.'
    )
  }

  let parsed: { questions?: RawGeneratedQuestion[] }
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      'Comprehension question generation failed: model response was not valid JSON.'
    )
  }

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : []
  const validQuestions: ComprehensionQuestion[] = rawQuestions
    .map(normalizeQuestion)
    .filter(
      (q): q is { question: string; options: string[]; answer: string } =>
        q !== null
    )
    .map((q) => ({ id: crypto.randomUUID(), ...q }))

  if (validQuestions.length === 0) {
    throw new Error(
      'Comprehension question generation failed: the model did not return any usable questions.'
    )
  }

  return validQuestions
}
