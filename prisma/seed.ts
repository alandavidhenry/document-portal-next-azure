// Local dev seed data — populates the database with example companies,
// users, templates, assignments and completions so the app looks in-use.
// Safe to re-run against an empty DB; not idempotent against a populated one.
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

import type {
  DocumentTemplateCategory,
  DocumentTemplateSourceType
} from '@/types/document-template'
import type { FormSchema } from '@/types/form-schema'

// Loaded before importing the prisma singleton (which reads DATABASE_URL at
// module-evaluation time) via dynamic import in run(), below — tsx doesn't
// load .env.local automatically.
config({ path: '.env.local' })

let prisma: typeof import('../src/lib/prisma').default
let toJsonValue: typeof import('../src/lib/prisma-json').toJsonValue

// Overridable so this isn't a fixed credential in source: `npm run db:seed -- <password>`
// or `SEED_PASSWORD=<password> npm run db:seed`. Falls back to a fixed dev-only
// default since this only ever runs against a local Docker Postgres.
const SEED_PASSWORD =
  process.argv[2] || process.env.SEED_PASSWORD || 'Password123!'

function daysFrom(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

const FORM_SCHEMA: FormSchema = [
  {
    id: 'confirm',
    label: 'I confirm I have read and understood this document',
    type: 'checkbox',
    required: true
  },
  {
    id: 'notes',
    label: 'Additional comments (optional)',
    type: 'textarea',
    required: false
  }
]

const TEMPLATE_DEFS: {
  title: string
  category: DocumentTemplateCategory
}[] = [
  { title: 'Fire Safety Induction', category: 'Fire Safety' },
  { title: 'Fire Extinguisher Training', category: 'Fire Safety' },
  { title: 'Emergency Evacuation Procedure', category: 'Fire Safety' },
  { title: 'COSHH Assessment - Cleaning Chemicals', category: 'COSHH' },
  { title: 'Chemical Spill Response', category: 'COSHH' },
  { title: 'First Aid Procedures', category: 'First Aid' },
  { title: 'Accident Reporting Procedure', category: 'First Aid' },
  { title: 'Manual Handling Training', category: 'Manual Handling' },
  { title: 'Safe Lifting Techniques', category: 'Manual Handling' },
  { title: 'PPE Policy Acknowledgement', category: 'PPE' },
  { title: 'Respiratory Protective Equipment Guidance', category: 'PPE' },
  {
    title: 'Risk Assessment - Warehouse Operations',
    category: 'Risk Assessment'
  },
  {
    title: 'Risk Assessment - Lone Working',
    category: 'Risk Assessment'
  },
  { title: 'Display Screen Equipment Assessment', category: 'General' },
  { title: 'General Health and Safety Induction', category: 'General' },
  { title: 'Working at Height Policy', category: 'Other' },
  { title: 'Lone Working Procedure', category: 'Other' },
  { title: 'Slips, Trips and Falls Awareness', category: 'Other' },
  { title: 'Noise at Work Assessment', category: 'Other' },
  { title: 'Vehicle and Forklift Safety', category: 'Other' }
]

const COMPANY_DEFS: { name: string; jobRoles: string[] }[] = [
  {
    name: 'Northgate Logistics',
    jobRoles: ['Warehouse Operative', 'Forklift Driver', 'Site Supervisor']
  },
  {
    name: 'Bramwell Construction',
    jobRoles: ['Site Labourer', 'Scaffolder', 'Site Manager']
  },
  {
    name: 'Solent Manufacturing',
    jobRoles: ['Machine Operator', 'Quality Inspector', 'Production Lead']
  },
  {
    name: 'Kestrel Retail Group',
    jobRoles: ['Sales Assistant', 'Stockroom Assistant', 'Store Manager']
  },
  {
    name: 'Marlowe Care Homes',
    jobRoles: ['Care Assistant', 'Senior Carer', 'Care Home Manager']
  }
]

async function main() {
  console.warn('Seeding database...')

  const tenant = await prisma.tenant.create({
    data: { name: 'Simon Fields H&S Consultancy' }
  })

  // ---------------------------------------------------------------------
  // Templates (tenant library, form-based, with a comprehension question)
  // ---------------------------------------------------------------------
  const sourceType: DocumentTemplateSourceType = 'form'
  const templates = []
  for (const def of TEMPLATE_DEFS) {
    const template = await prisma.documentTemplate.create({
      data: {
        title: def.title,
        description: `${def.title} — required reading for all relevant staff.`,
        category: def.category,
        sourceType,
        tenantId: tenant.id,
        formSchema: toJsonValue(FORM_SCHEMA),
        questions: toJsonValue([
          {
            id: 'q1',
            question: `Have you read and understood the "${def.title}" document?`,
            options: ['Yes', 'No'],
            answer: 'Yes'
          }
        ])
      }
    })
    templates.push(template)
  }

  // ---------------------------------------------------------------------
  // Companies + users (3 per company: 1 Customer Admin, 2 Customer User;
  // one company gets a no-email worker routed to their line manager)
  // ---------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)

  for (let i = 0; i < COMPANY_DEFS.length; i++) {
    const def = COMPANY_DEFS[i]
    const company = await prisma.customerCompany.create({
      data: { name: def.name, tenantId: tenant.id }
    })

    const admin = await prisma.user.create({
      data: {
        email: `admin@${slugify(def.name)}.example.com`,
        displayName: `${def.name.split(' ')[0]} Admin`,
        passwordHash,
        role: 'Customer Admin',
        jobRole: def.jobRoles[2],
        tenantId: tenant.id,
        customerCompanyId: company.id
      }
    })

    const userA = await prisma.user.create({
      data: {
        email: `worker1@${slugify(def.name)}.example.com`,
        displayName: `${def.jobRoles[0]} One`,
        passwordHash,
        role: 'Customer User',
        jobRole: def.jobRoles[0],
        tenantId: tenant.id,
        customerCompanyId: company.id
      }
    })

    // Every third company gets a no-email worker routed to the admin
    const userB =
      i % 3 === 2
        ? await prisma.user.create({
            data: {
              displayName: `${def.jobRoles[1]} Two (no email)`,
              role: 'Customer User',
              jobRole: def.jobRoles[1],
              tenantId: tenant.id,
              customerCompanyId: company.id,
              lineManagerId: admin.id
            }
          })
        : await prisma.user.create({
            data: {
              email: `worker2@${slugify(def.name)}.example.com`,
              displayName: `${def.jobRoles[1]} Two`,
              passwordHash,
              role: 'Customer User',
              jobRole: def.jobRoles[1],
              tenantId: tenant.id,
              customerCompanyId: company.id
            }
          })

    const companyUsers = [admin, userA, userB]

    // Four company-wide assignments per company, each in a different state,
    // drawn from a distinct slice of the 20 templates.
    const slice = templates.slice(i * 4, i * 4 + 4)
    const [overdueTemplate, dueSoonTemplate, doneTemplate, futureTemplate] =
      slice

    await createAssignmentWithCompletions({
      templateId: overdueTemplate.id,
      companyId: company.id,
      dueDate: daysFrom(-10),
      completedBy: [companyUsers[0]], // 1 of 3 done, 2 overdue
      signedDaysAgo: 20
    })

    await createAssignmentWithCompletions({
      templateId: dueSoonTemplate.id,
      companyId: company.id,
      dueDate: daysFrom(5),
      completedBy: [companyUsers[0], companyUsers[1]], // 2 of 3 done
      signedDaysAgo: 2
    })

    await createAssignmentWithCompletions({
      templateId: doneTemplate.id,
      companyId: company.id,
      dueDate: null,
      completedBy: companyUsers, // fully compliant
      signedDaysAgo: 6
    })

    await createAssignmentWithCompletions({
      templateId: futureTemplate.id,
      companyId: company.id,
      dueDate: daysFrom(30),
      completedBy: [], // nothing done yet, not overdue
      signedDaysAgo: 0
    })

    // Individual overdue assignment direct to the Customer Admin, unactioned
    await prisma.assignment.create({
      data: {
        templateId: overdueTemplate.id,
        customerCompanyId: company.id,
        userId: admin.id,
        dueDate: daysFrom(-3),
        templateVersion: 1
      }
    })
  }

  console.warn(
    `Seeded 1 tenant, ${COMPANY_DEFS.length} companies, ${COMPANY_DEFS.length * 3} users, ${templates.length} templates.`
  )
  console.warn(`All seeded company users' password: ${SEED_PASSWORD}`)
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

async function createAssignmentWithCompletions({
  templateId,
  companyId,
  dueDate,
  completedBy,
  signedDaysAgo
}: {
  templateId: string
  companyId: string
  dueDate: Date | null
  completedBy: { id: string }[]
  signedDaysAgo: number
}) {
  const assignment = await prisma.assignment.create({
    data: {
      templateId,
      customerCompanyId: companyId,
      dueDate,
      templateVersion: 1
    }
  })

  for (const user of completedBy) {
    await prisma.completionRecord.create({
      data: {
        assignmentId: assignment.id,
        signedById: user.id,
        signedAt: daysFrom(-signedDaysAgo),
        formData: { confirm: true, notes: '' }
      }
    })
  }

  return assignment
}

async function run() {
  ;({ default: prisma } = await import('../src/lib/prisma'))
  ;({ toJsonValue } = await import('../src/lib/prisma-json'))
  await main()
}

run()
  .catch((error) => {
    console.error('Seeding failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
