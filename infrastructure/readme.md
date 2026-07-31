# Minato Infrastructure

Terraform code for the Minato Azure infrastructure. Organised into reusable modules and environment-specific configurations.

## Directory Structure

```
infrastructure/
├── bootstrap/            # One-time state backend setup
├── env/
│   ├── Development/      # Development environment
│   └── Production/       # Production environment
└── modules/
    ├── resource_group/
    ├── key_vault/
    ├── storage/
    ├── app_service/
    ├── document_intelligence/
    ├── communication_service/
    ├── gotenberg/
    ├── ai_foundry/            # Comprehension-question generation (infra only, no app code yet)
    ├── postgres_flexible_server/  # Scaffolded, not wired into minato/ — see below
    └── minato/  # Composition module — orchestrates all others
```

## First-time provisioning (new Azure account)

### Prerequisites

- [Terraform](https://www.terraform.io/downloads.html) ≥ 1.11
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) — logged in to the target account
- GitHub PAT with `read:packages` scope (for GHCR image pulls)
- Neon PostgreSQL connection string

### Azure CLI login

If the browser login dialog does not show the correct account, use the device code flow to sign in manually:

```powershell
az login --tenant <TENANT_ID> --use-device-code
```

This prints a code. Open `https://microsoft.com/devicelogin`, enter the code, then sign in with the correct account. Find your tenant ID in **Azure Portal → Entra ID → Overview → Tenant ID**.

### Register required resource providers

Run once per subscription before the first `terraform apply`. The `Microsoft.Communication` provider is not registered by default and Terraform will fail to create Azure Communication Services resources without it.

```powershell
az provider register --namespace Microsoft.Communication
```

Check registration status (takes ~1 minute):

```powershell
az provider show --namespace Microsoft.Communication --query registrationState
```

Wait until the output is `"Registered"` before proceeding.

### 1 — Bootstrap (Terraform state backend)

Run once per environment to create the Azure Storage account that holds Terraform state. Bootstrap uses local state and is run manually — it does not go through CI/CD.

**Development:**
```powershell
cd infrastructure/bootstrap/Development
terraform init
terraform apply -var="subscription_id=YOUR_SUBSCRIPTION_ID"
```

**Production:**
```powershell
cd infrastructure/bootstrap/Production
terraform init
terraform apply -var="subscription_id=YOUR_SUBSCRIPTION_ID"
```

### 2 — Create secrets files

```powershell
# Run in both env/Development and env/Production
Copy-Item secrets.auto.tfvars.example secrets.auto.tfvars
```

Fill in each `secrets.auto.tfvars`:

```hcl
subscription_id = "YOUR_AZURE_SUBSCRIPTION_ID"
github_token    = "YOUR_GITHUB_PAT"        # read:packages scope
database_url    = "YOUR_NEON_POSTGRES_URL"
```

These files are `.gitignore`d — never commit them.

### 3 — Create a service principal for GitHub Actions (OIDC)

```powershell
az ad sp create-for-rbac --name "sp-minato-github"
```

Then add federated credentials for each GitHub environment:

```powershell
az ad app federated-credential create `
  --id <APP_ID> `
  --parameters '{
    "name": "minato-development",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:alandavidhenry/minato:environment:Development",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create `
  --id <APP_ID> `
  --parameters '{
    "name": "minato-production",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:alandavidhenry/minato:environment:Production",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Grant the SP **Owner** on the subscription (Contributor alone is insufficient — Owner is required to create role assignments) and **Storage Blob Data Contributor** on the Terraform state storage accounts.

### 4 — Configure GitHub Actions environments

In **GitHub → repo → Settings → Environments**, configure `Development` and `Production`:

**Secrets:**

| Secret | Value |
|--------|-------|
| `ARM_CLIENT_ID` | SP application (client) ID |
| `ARM_TENANT_ID` | Azure tenant ID |
| `ARM_SUBSCRIPTION_ID` | Azure subscription ID |
| `DATABASE_URL` | Neon connection string |
| `CRON_SECRET` | `terraform output -raw cron_secret` (per environment) |
| `DOCKERHUB_USERNAME` | Docker Hub username (for hardened base images) |
| `DOCKERHUB_TOKEN` | Docker Hub access token |

**Variables:**

| Variable | Value |
|----------|-------|
| `AZURE_APP_NAME` | `terraform output app_service_name` |
| `AZURE_RESOURCE_GROUP` | `terraform output resource_group_name` |
| `NEXTAUTH_URL` | `https://<AZURE_APP_NAME>.azurewebsites.net` |

### 5 — Provision infrastructure via GitHub Actions

Push to `main` to trigger the `Terraform - CICD` workflow. This will:
- Validate and plan both environments
- Automatically apply to **Development** on the `main` branch

To apply to **Production**, push a version tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

This triggers the `Terraform - Prod Deploy` workflow, which validates then applies to Production.

### 6 — Deploy the app

Push any app file change to `main` to trigger the dev deploy pipeline:
1. Builds and pushes the Docker image to GHCR (`ghcr.io/alandavidhenry/minato`)
2. Runs `prisma migrate deploy` against Neon
3. Sets the container image on the Development App Service
4. Smoke-tests `GET /api/health/deep` (12 retries × 15 s)

For Production, publish a GitHub release from a tag.

---

## Routine apply (after infrastructure changes)

Infrastructure changes are applied via GitHub Actions — push to `main` for Development, push a `v*` tag for Production. To test locally before pushing:

```powershell
cd infrastructure/env/Development   # or Production
terraform init
terraform plan
```

---

## Key Vault RBAC

The Key Vault uses Azure RBAC (`rbac_authorization_enabled = true`) rather than vault access policies. Role assignments are managed by Terraform:

| Principal | Role | Purpose |
|-----------|------|---------|
| Deploying principal (local user or GitHub Actions SP) | Key Vault Secrets Officer | Read/write secrets during `terraform apply` |
| App Service managed identity | Key Vault Secrets User | Read secrets at runtime |

The deploying principal is identified dynamically via `data.azurerm_client_config.current.object_id`, so the same code works for both local applies (your user account) and CI/CD applies (the service principal).

### First-time apply caveat

Azure RBAC assignments take up to 60 seconds to propagate. On a fresh apply where the Key Vault is being created for the first time, use a targeted apply to create the role assignment first:

```powershell
terraform apply -target='module.minato.azurerm_role_assignment.kv_deployer'
# wait ~60 seconds
terraform apply
```

Subsequent applies handle this automatically via a `time_sleep` resource in the Terraform code.

---

## What Terraform manages

| Resource | Notes |
|----------|-------|
| Resource Group | Per environment |
| Key Vault | RBAC-enabled; secrets written by Terraform, read by App Service at runtime |
| Storage Account | Blob container `documents`; Table `activityLogs` (audit trail) |
| App Service Plan + App | Linux, Docker, system-assigned managed identity |
| Document Intelligence | Free tier (F0); 500 pages/month |
| Azure Communication Services | Email via managed Azure domain; 100 emails/day free |

## What Terraform does NOT manage

- Docker image tags — updated by GitHub Actions on every deploy
- Neon PostgreSQL database schema — managed by `prisma migrate deploy` in the CI pipeline
- GitHub Actions secrets — set manually (they contain values that only exist after `terraform apply`)

## Optional modules (scaffolded, not provisioned)

`modules/postgres_flexible_server/` defines an Azure Database for PostgreSQL Flexible Server as a paid backup/scale-up path alongside the free Neon tier. It is **not** referenced by `modules/minato/main.tf`, so it costs nothing today — `terraform plan`/`apply` on either environment ignores it entirely.

No app code change is needed to cut over: `src/lib/prisma.ts` only ever reads `DATABASE_URL`, and Flexible Server speaks the same Postgres wire protocol Neon does. To switch:
1. Add a `module "postgres_flexible_server" { ... }` block to `modules/minato/main.tf` (mirroring how `module "gotenberg"` is wired) and apply.
2. Point the `DATABASE_URL` app setting at `module.postgres_flexible_server.connection_string_secret_versionless_id` instead of `azurerm_key_vault_secret.database_url`.
3. Run `prisma migrate deploy` against the new server.
4. Apply again.
