// src/app/api/admin/templates/[id]/generate-questions/route.ts
// Suggests draft comprehension questions for a template using the Azure AI
// Foundry model deployment (infrastructure/modules/ai_foundry/). Nothing is
// written to the database here - the admin reviews/edits the suggestions in
// edit-template-dialog.tsx and only persists them via the existing Save/
// Publish flow (human-review gate).
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { generateComprehensionQuestions } from '@/lib/comprehension-question-generation'
import { getTemplateSourceText } from '@/lib/comprehension-question-source'
import { getDocumentTemplateById } from '@/lib/document-templates'
import { ADMIN_ROLES } from '@/types/rbac'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const roles = session?.user?.roles ?? []

  if (!roles.some((r) => ADMIN_ROLES.includes(r))) {
    return NextResponse.json(
      { error: 'Unauthorized. Admin access required.' },
      { status: 403 }
    )
  }

  const { id } = await params
  const template = await getDocumentTemplateById(id)

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  let sourceText: string
  try {
    sourceText = await getTemplateSourceText(template)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not read this template to generate questions from.'
      },
      { status: 400 }
    )
  }

  try {
    const questions = await generateComprehensionQuestions(sourceText)
    return NextResponse.json({ questions })
  } catch (error) {
    console.error('Error generating comprehension questions:', error)
    return NextResponse.json(
      { error: 'Failed to generate comprehension questions.' },
      { status: 500 }
    )
  }
}
