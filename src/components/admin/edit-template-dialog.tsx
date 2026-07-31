'use client'

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  FIELD_TYPE_LABELS,
  FieldTypePalette
} from '@/components/admin/form-builder/field-type-palette'
import { SortableFieldCard } from '@/components/admin/form-builder/sortable-field-card'
import { StarterTemplatePicker } from '@/components/admin/form-builder/starter-template-picker'
import { PublishVersionDialog } from '@/components/admin/publish-version-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import type { ComprehensionQuestion } from '@/types/comprehension-question'
import {
  DOCUMENT_TEMPLATE_CATEGORIES,
  type DocumentTemplateCategory,
  type DocumentTemplateSourceType,
  type DocumentTemplateUploadMode
} from '@/types/document-template'
import type { FormField, FormFieldType } from '@/types/form-schema'

function isCheckboxField(f: FormField) {
  return f.type === 'checkbox'
}

interface UploadedDocument {
  blobPath: string
  originalBlobPath: string | null
  fileName: string
}

interface Template {
  id: string
  title: string
  description: string | null
  formSchema: FormField[] | null
  questions: ComprehensionQuestion[] | null
  category?: string
  sourceType?: DocumentTemplateSourceType
  uploadMode?: DocumentTemplateUploadMode | null
  sourceDocFileName?: string | null
}

interface EditTemplateDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly template: Template | null
  readonly onTemplateSaved: (publishedNewVersion?: boolean) => void
  readonly apiBasePath?: string
}

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function createField(type: FormFieldType): FormField {
  const base: FormField = { id: generateId(), label: '', type, required: false }
  return type === 'select' ? { ...base, options: ['', ''] } : base
}

function FieldsCanvas({
  items,
  children
}: {
  readonly items: string[]
  readonly children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: 'fields-canvas' })
  return (
    <div ref={setNodeRef} className='grid gap-3 min-h-[2.5rem]'>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  )
}

export function EditTemplateDialog({
  open,
  onOpenChange,
  template,
  onTemplateSaved,
  apiBasePath = '/api/admin/templates'
}: EditTemplateDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<DocumentTemplateCategory>('General')
  const [fields, setFields] = useState<FormField[]>([])
  const [questions, setQuestions] = useState<ComprehensionQuestion[]>([])
  const [uploadMode, setUploadMode] =
    useState<DocumentTemplateUploadMode>('read-only')
  const [sourceDocFileName, setSourceDocFileName] = useState<string | null>(
    null
  )
  const [newUpload, setNewUpload] = useState<UploadedDocument | null>(null)
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isUploadTemplate = template?.sourceType === 'upload'
  // AI question generation is admin-portal-only for now — the customer
  // self-serve portal passes a different apiBasePath and doesn't get this
  // route, so the button is hidden there rather than shown broken.
  const canGenerateQuestions =
    !apiBasePath || apiBasePath === '/api/admin/templates'

  useEffect(() => {
    if (template) {
      setTitle(template.title)
      setDescription(template.description ?? '')
      setCategory((template.category as DocumentTemplateCategory) ?? 'General')
      setFields(template.formSchema ?? [])
      setQuestions(template.questions ?? [])
      setUploadMode(template.uploadMode ?? 'read-only')
      setSourceDocFileName(template.sourceDocFileName ?? null)
      setNewUpload(null)
    }
  }, [template])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setIsUploadingFile(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`${apiBasePath}/upload-document`, {
        method: 'POST',
        body
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload document')
      }

      const uploaded = (await response.json()) as UploadedDocument
      setNewUpload(uploaded)
      setSourceDocFileName(uploaded.fileName)
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive'
      })
    } finally {
      setIsUploadingFile(false)
    }
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function clearOrphanedConditions(next: FormField[]): FormField[] {
    return next.map((f, i) => {
      if (!f.condition) return f
      const condIdx = next.findIndex((c) => c.id === f.condition!.fieldId)
      return condIdx < i ? f : { ...f, condition: undefined }
    })
  }

  function appendField(type: FormFieldType = 'text') {
    setFields((prev) => [...prev, createField(type)])
  }

  function insertFieldBefore(beforeId: string, type: FormFieldType) {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === beforeId)
      if (idx === -1) return [...prev, createField(type)]
      const next = [...prev]
      next.splice(idx, 0, createField(type))
      return next
    })
  }

  function loadStarterTemplate(starterFields: FormField[]) {
    setFields(starterFields)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)

    if (activeId.startsWith('palette-')) {
      const type = active.data.current?.paletteType as FormFieldType
      const overId = String(over.id)
      if (overId === 'fields-canvas') {
        appendField(type)
      } else {
        insertFieldBefore(overId, type)
      }
      return
    }

    if (active.id === over.id) return

    setFields((prev) => {
      const oldIndex = prev.findIndex((f) => f.id === active.id)
      const newIndex = prev.findIndex((f) => f.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return clearOrphanedConditions(arrayMove(prev, oldIndex, newIndex))
    })
  }

  function availableConditionFields(fieldId: string): FormField[] {
    const idx = fields.findIndex((f) => f.id === fieldId)
    return fields.slice(0, idx).filter(isCheckboxField)
  }

  function addFieldOption(fieldId: string) {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId ? { ...f, options: [...(f.options ?? []), ''] } : f
      )
    )
  }

  function updateFieldOption(
    fieldId: string,
    optionIndex: number,
    value: string
  ) {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId) return f
        const options = (f.options ?? []).map((o, i) =>
          i === optionIndex ? value : o
        )
        return { ...f, options }
      })
    )
  }

  function removeFieldOption(fieldId: string, optionIndex: number) {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? {
              ...f,
              options: (f.options ?? []).filter((_, i) => i !== optionIndex)
            }
          : f
      )
    )
  }

  function removeField(id: string) {
    setFields((prev) =>
      prev
        .filter((f) => f.id !== id)
        .map((f) =>
          f.condition?.fieldId === id ? { ...f, condition: undefined } : f
        )
    )
  }

  function updateField(id: string, changes: Partial<FormField>) {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id === id) return { ...f, ...changes }
        // If this field's type is changing away from checkbox, clear any
        // conditions on other fields that reference it
        if (
          changes.type &&
          changes.type !== 'checkbox' &&
          f.condition?.fieldId === id
        ) {
          return { ...f, condition: undefined }
        }
        return f
      })
    )
  }

  async function handleGenerateQuestions() {
    if (!template?.id) return

    setIsGeneratingQuestions(true)
    try {
      const response = await fetch(
        `/api/admin/templates/${template.id}/generate-questions`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate questions')
      }

      const { questions: generated } = (await response.json()) as {
        questions: ComprehensionQuestion[]
      }
      setQuestions((prev) => [...prev, ...generated])
      toast({
        title: 'Questions generated',
        description: `Added ${generated.length} draft question${generated.length === 1 ? '' : 's'} — review and edit before saving.`
      })
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to generate questions',
        variant: 'destructive'
      })
    } finally {
      setIsGeneratingQuestions(false)
    }
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { id: generateId(), question: '', options: ['', ''], answer: '' }
    ])
  }

  function addOption(questionId: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === questionId ? { ...q, options: [...q.options, ''] } : q
      )
    )
  }

  function updateOption(
    questionId: string,
    optionIndex: number,
    value: string
  ) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId) return q
        const updatedOptions = q.options.map((o, i) =>
          i === optionIndex ? value : o
        )
        // If the previously-correct option text was changed, update answer too
        const answer = q.answer === q.options[optionIndex] ? value : q.answer
        return { ...q, options: updatedOptions, answer }
      })
    )
  }

  function removeOption(questionId: string, optionIndex: number) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId) return q
        const updatedOptions = q.options.filter((_, i) => i !== optionIndex)
        const answer = q.answer === q.options[optionIndex] ? '' : q.answer
        return { ...q, options: updatedOptions, answer }
      })
    )
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== id))
  }

  function updateQuestion(id: string, changes: Partial<ComprehensionQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...changes } : q))
    )
  }

  function validateForm(): boolean {
    if (!title.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Template title is required',
        variant: 'destructive'
      })
      return false
    }

    const emptyLabels = fields.filter((f) => !f.label.trim())
    if (emptyLabels.length > 0) {
      toast({
        title: 'Validation Error',
        description: 'All form fields must have a label',
        variant: 'destructive'
      })
      return false
    }

    const invalidSelectFields = fields.filter(
      (f) =>
        f.type === 'select' &&
        ((f.options ?? []).length < 2 ||
          (f.options ?? []).some((o) => !o.trim()))
    )
    if (invalidSelectFields.length > 0) {
      toast({
        title: 'Validation Error',
        description:
          'Each dropdown field must have at least 2 non-empty options',
        variant: 'destructive'
      })
      return false
    }

    for (const q of questions) {
      if (!q.question.trim()) {
        toast({
          title: 'Validation Error',
          description: 'All comprehension questions must have question text',
          variant: 'destructive'
        })
        return false
      }
      if (q.options.length < 2) {
        toast({
          title: 'Validation Error',
          description:
            'Each comprehension question must have at least 2 options',
          variant: 'destructive'
        })
        return false
      }
      if (q.options.some((o) => !o.trim())) {
        toast({
          title: 'Validation Error',
          description: 'All answer options must have text',
          variant: 'destructive'
        })
        return false
      }
      if (!q.answer || !q.options.includes(q.answer)) {
        toast({
          title: 'Validation Error',
          description:
            'Please select the correct answer for each comprehension question',
          variant: 'destructive'
        })
        return false
      }
    }
    return true
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!validateForm()) return

    setIsLoading(true)

    try {
      const response = await fetch(`${apiBasePath}/${template?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          category,
          formSchema: fields.length > 0 ? fields : null,
          questions: questions.length > 0 ? questions : null,
          ...(isUploadTemplate && { uploadMode }),
          ...(newUpload && {
            sourceDocBlobPath: newUpload.blobPath,
            sourceDocOriginalBlobPath: newUpload.originalBlobPath,
            sourceDocFileName: newUpload.fileName
          })
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save template')
      }

      onTemplateSaved()
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to save template',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }

  function handlePublishAsNewVersion() {
    if (!validateForm()) return
    setShowPublishDialog(true)
  }

  async function confirmPublishAsNewVersion(changeReason: string) {
    setIsPublishing(true)

    try {
      const response = await fetch(
        `${apiBasePath}/${template?.id}/publish-version`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeReason,
            title: title.trim(),
            description: description.trim() || null,
            category,
            formSchema: fields.length > 0 ? fields : null,
            questions: questions.length > 0 ? questions : null,
            ...(newUpload && {
              sourceDocBlobPath: newUpload.blobPath,
              sourceDocOriginalBlobPath: newUpload.originalBlobPath,
              sourceDocFileName: newUpload.fileName
            })
          })
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to publish new version')
      }

      const data = await response.json()
      toast({
        title: 'New version published',
        description: `Now v${data.newVersion}. ${data.assignmentsCreated} new assignment${data.assignmentsCreated === 1 ? '' : 's'} created.`
      })
      setShowPublishDialog(false)
      onTemplateSaved(true)
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to publish new version',
        variant: 'destructive'
      })
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px] max-h-[85vh] overflow-y-auto'>
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update the template details and define the form fields customers
              will fill in.
            </DialogDescription>
          </DialogHeader>

          <div className='rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200'>
            Saving here updates the template content without triggering new
            sign-off assignments. Use{' '}
            <span className='font-semibold'>Publish New Version</span> (the
            refresh icon on the templates page) when workers need to re-sign
            because the document requirements have changed.
          </div>

          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='edit-title'>Title</Label>
              <Input
                id='edit-title'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='edit-description'>
                Description{' '}
                <span className='text-muted-foreground'>(optional)</span>
              </Label>
              <Input
                id='edit-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Brief description of the document'
                disabled={isLoading}
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='edit-category'>Category</Label>
              <Select
                value={category}
                onValueChange={(value) =>
                  setCategory(value as DocumentTemplateCategory)
                }
              >
                <SelectTrigger id='edit-category' disabled={isLoading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TEMPLATE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {!isUploadTemplate && (
              <div className='grid gap-3'>
                <div className='flex items-center justify-between'>
                  <Label>Form Fields</Label>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => appendField('text')}
                    disabled={isLoading}
                  >
                    <Plus className='mr-1 h-3 w-3' />
                    Add Field
                  </Button>
                </div>

                {fields.length === 0 && (
                  <>
                    <p className='text-sm text-muted-foreground'>
                      No form fields yet. Add fields for customers to fill in
                      when completing this document.
                    </p>
                    <StarterTemplatePicker onSelect={loadStarterTemplate} />
                  </>
                )}

                <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
                  <div className='grid gap-4 md:grid-cols-[1fr_180px] items-start'>
                    <FieldsCanvas items={fields.map((f) => f.id)}>
                      {fields.map((field, index) => (
                        <SortableFieldCard key={field.id} id={field.id}>
                          <div className='rounded-md border p-3 grid gap-3'>
                            <div className='flex items-center justify-between'>
                              <span className='text-sm font-medium text-muted-foreground'>
                                Field {index + 1}
                              </span>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={() => removeField(field.id)}
                                disabled={isLoading}
                              >
                                <Trash2 className='h-3 w-3' />
                              </Button>
                            </div>

                            <div className='grid gap-2'>
                              <Label htmlFor={`label-${field.id}`}>Label</Label>
                              <Input
                                id={`label-${field.id}`}
                                value={field.label}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    label: e.target.value
                                  })
                                }
                                placeholder='e.g. Are fire exits clear and unobstructed?'
                                disabled={isLoading}
                              />
                            </div>

                            <div className='grid grid-cols-2 gap-3'>
                              <div className='grid gap-2'>
                                <Label htmlFor={`type-${field.id}`}>Type</Label>
                                <Select
                                  value={field.type}
                                  onValueChange={(value) => {
                                    const newType = value as FormFieldType
                                    updateField(field.id, {
                                      type: newType,
                                      ...((newType === 'checkbox' ||
                                        newType === 'section') && {
                                        required: false
                                      }),
                                      options:
                                        newType === 'select'
                                          ? (field.options ?? ['', ''])
                                          : undefined
                                    })
                                  }}
                                  disabled={isLoading}
                                >
                                  <SelectTrigger id={`type-${field.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(
                                      Object.entries(FIELD_TYPE_LABELS) as [
                                        FormFieldType,
                                        string
                                      ][]
                                    ).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {field.type !== 'checkbox' &&
                                field.type !== 'section' && (
                                  <div className='flex items-end gap-2 pb-1'>
                                    <Checkbox
                                      id={`required-${field.id}`}
                                      checked={field.required}
                                      onCheckedChange={(checked) =>
                                        updateField(field.id, {
                                          required: checked === true
                                        })
                                      }
                                      disabled={isLoading}
                                    />
                                    <Label
                                      htmlFor={`required-${field.id}`}
                                      className='cursor-pointer'
                                    >
                                      Required
                                    </Label>
                                  </div>
                                )}
                            </div>

                            {field.type === 'select' && (
                              <div className='grid gap-2'>
                                <div className='flex items-center justify-between'>
                                  <Label>Dropdown options</Label>
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => addFieldOption(field.id)}
                                    disabled={isLoading}
                                  >
                                    <Plus className='mr-1 h-3 w-3' />
                                    Add Option
                                  </Button>
                                </div>
                                {(field.options ?? []).map((option, optIdx) => (
                                  <div
                                    key={optIdx}
                                    className='flex items-center gap-2'
                                  >
                                    <Input
                                      value={option}
                                      onChange={(e) =>
                                        updateFieldOption(
                                          field.id,
                                          optIdx,
                                          e.target.value
                                        )
                                      }
                                      placeholder={`Option ${optIdx + 1}`}
                                      disabled={isLoading}
                                      className='flex-1 h-8 text-sm'
                                    />
                                    {(field.options ?? []).length > 2 && (
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='sm'
                                        onClick={() =>
                                          removeFieldOption(field.id, optIdx)
                                        }
                                        disabled={isLoading}
                                      >
                                        <Trash2 className='h-3 w-3' />
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {availableConditionFields(field.id).length > 0 && (
                              <div className='grid gap-2'>
                                <Label>Show only when</Label>
                                <div className='flex gap-2'>
                                  <Select
                                    value={field.condition?.fieldId ?? 'none'}
                                    onValueChange={(value) => {
                                      if (value === 'none') {
                                        updateField(field.id, {
                                          condition: undefined
                                        })
                                      } else {
                                        updateField(field.id, {
                                          condition: {
                                            fieldId: value,
                                            value:
                                              field.condition?.value ?? true
                                          }
                                        })
                                      }
                                    }}
                                    disabled={isLoading}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value='none'>
                                        Always show
                                      </SelectItem>
                                      {availableConditionFields(field.id).map(
                                        (cf) => (
                                          <SelectItem key={cf.id} value={cf.id}>
                                            {cf.label ||
                                              `Checkbox ${fields.indexOf(cf) + 1}`}
                                          </SelectItem>
                                        )
                                      )}
                                    </SelectContent>
                                  </Select>
                                  {field.condition && (
                                    <Select
                                      value={
                                        field.condition.value ? 'true' : 'false'
                                      }
                                      onValueChange={(value) =>
                                        updateField(field.id, {
                                          condition: {
                                            fieldId: field.condition!.fieldId,
                                            value: value === 'true'
                                          }
                                        })
                                      }
                                      disabled={isLoading}
                                    >
                                      <SelectTrigger className='w-28'>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value='true'>
                                          is Yes
                                        </SelectItem>
                                        <SelectItem value='false'>
                                          is No
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </SortableFieldCard>
                      ))}
                    </FieldsCanvas>

                    <FieldTypePalette
                      onAppend={appendField}
                      disabled={isLoading}
                    />
                  </div>
                </DndContext>
              </div>
            )}

            {isUploadTemplate && (
              <div className='grid gap-3'>
                <div className='grid gap-2'>
                  <Label>How staff complete it</Label>
                  <RadioGroup
                    value={uploadMode}
                    onValueChange={(value) =>
                      setUploadMode(value as DocumentTemplateUploadMode)
                    }
                  >
                    <div className='flex items-center gap-2'>
                      <RadioGroupItem
                        value='read-only'
                        id='edit-mode-read-only'
                      />
                      <Label
                        htmlFor='edit-mode-read-only'
                        className='cursor-pointer font-normal'
                      >
                        Read-only — staff read and sign
                      </Label>
                    </div>
                    <div className='flex items-center gap-2'>
                      <RadioGroupItem
                        value='fill-and-return'
                        id='edit-mode-fill-and-return'
                      />
                      <Label
                        htmlFor='edit-mode-fill-and-return'
                        className='cursor-pointer font-normal'
                      >
                        Fill in and return — staff download, complete, and
                        upload it back
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className='grid gap-2'>
                  <Label>Document</Label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.doc,.docx,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    className='hidden'
                    onChange={handleFileSelected}
                    disabled={isUploadingFile || isLoading}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingFile || isLoading}
                  >
                    {isUploadingFile ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Uploading &amp; converting...
                      </>
                    ) : (
                      <>
                        <Upload className='mr-2 h-4 w-4' />
                        Replace file
                      </>
                    )}
                  </Button>
                  {sourceDocFileName && (
                    <p className='text-sm text-muted-foreground'>
                      Current file: {sourceDocFileName}
                    </p>
                  )}
                </div>
              </div>
            )}

            <Separator />

            <div className='grid gap-3'>
              <div className='flex items-center justify-between'>
                <div>
                  <Label>Comprehension Questions</Label>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    Customers must answer these correctly before signing.
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {canGenerateQuestions && (
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={handleGenerateQuestions}
                      disabled={isLoading || isGeneratingQuestions}
                    >
                      {isGeneratingQuestions ? (
                        <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                      ) : (
                        <Sparkles className='mr-1 h-3 w-3' />
                      )}
                      Generate with AI
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={addQuestion}
                    disabled={isLoading}
                  >
                    <Plus className='mr-1 h-3 w-3' />
                    Add Question
                  </Button>
                </div>
              </div>

              {questions.length === 0 && (
                <p className='text-sm text-muted-foreground'>
                  No comprehension questions. Add questions customers must
                  answer correctly before they can sign off.
                </p>
              )}

              {questions.map((q, index) => (
                <div key={q.id} className='rounded-md border p-3 grid gap-3'>
                  <div className='flex items-center justify-between'>
                    <span className='text-sm font-medium text-muted-foreground'>
                      Question {index + 1}
                    </span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => removeQuestion(q.id)}
                      disabled={isLoading}
                    >
                      <Trash2 className='h-3 w-3' />
                    </Button>
                  </div>

                  <div className='grid gap-2'>
                    <Label htmlFor={`question-${q.id}`}>Question</Label>
                    <Input
                      id={`question-${q.id}`}
                      value={q.question}
                      onChange={(e) =>
                        updateQuestion(q.id, { question: e.target.value })
                      }
                      placeholder='e.g. What should you do if you discover a fire?'
                      disabled={isLoading}
                    />
                  </div>

                  <div className='grid gap-2'>
                    <div className='flex items-center justify-between'>
                      <Label>
                        Answer Options{' '}
                        <span className='text-muted-foreground font-normal'>
                          — select the correct one
                        </span>
                      </Label>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => addOption(q.id)}
                        disabled={isLoading}
                      >
                        <Plus className='mr-1 h-3 w-3' />
                        Add Option
                      </Button>
                    </div>
                    <RadioGroup
                      value={q.answer}
                      onValueChange={(value) =>
                        updateQuestion(q.id, { answer: value })
                      }
                      disabled={isLoading}
                    >
                      {q.options.map((option, optIdx) => (
                        <div key={optIdx} className='flex items-center gap-2'>
                          <RadioGroupItem
                            value={option}
                            id={`opt-${q.id}-${optIdx}`}
                            disabled={!option.trim() || isLoading}
                          />
                          <Input
                            value={option}
                            onChange={(e) =>
                              updateOption(q.id, optIdx, e.target.value)
                            }
                            placeholder={`Option ${optIdx + 1}`}
                            disabled={isLoading}
                            className='flex-1 h-8 text-sm'
                          />
                          {q.options.length > 2 && (
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              onClick={() => removeOption(q.id, optIdx)}
                              disabled={isLoading}
                            >
                              <Trash2 className='h-3 w-3' />
                            </Button>
                          )}
                        </div>
                      ))}
                    </RadioGroup>
                    <p className='text-xs text-muted-foreground'>
                      The selected option is the correct answer — not shown to
                      customers.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className='flex-col gap-2 sm:flex-row'>
            <Button
              type='button'
              variant='outline'
              disabled={isLoading || isPublishing}
              onClick={handlePublishAsNewVersion}
            >
              Publish as New Version
            </Button>
            <Button type='submit' disabled={isLoading || isPublishing}>
              {isLoading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving...
                </>
              ) : (
                'Save Template'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <PublishVersionDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        templateTitle={title}
        isSubmitting={isPublishing}
        onConfirm={confirmPublishAsNewVersion}
      />
    </Dialog>
  )
}
