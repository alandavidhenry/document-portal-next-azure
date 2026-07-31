# Generate random password for NextAuth secret
resource "random_password" "nextauth_secret" {
  length      = 32
  special     = true
  min_special = 1
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
  # Only create this on first run
  keepers = {
    first_run = "true"
  }
}

# Generate random token for the cron reminders endpoint
resource "random_password" "cron_secret" {
  length      = 32
  special     = false
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
  keepers = {
    first_run = "true"
  }
}

module "resource_group" {
  source = "../resource_group"

  project             = var.project
  environment         = var.environment
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = local.common_tags
}

module "key_vault" {
  source = "../key_vault"

  project             = var.project
  environment         = var.environment
  location            = var.location
  resource_group_name = module.resource_group.resource_group_name
  sku_name            = var.key_vault.sku_name
  tags                = local.common_tags

  secrets = {}
}

module "storage" {
  source = "../storage"

  project                  = var.project
  environment              = var.environment
  location                 = var.location
  resource_group_name      = module.resource_group.resource_group_name
  account_tier             = var.storage.account_tier
  account_replication_type = var.storage.account_replication_type
  min_tls_version          = var.storage.min_tls_version
  allowed_origins          = var.allowed_origins
  tags                     = local.common_tags

  containers = {
    "${var.storage_container.name}" = {
      access_type = var.storage_container.container_access_type
    }
  }
}

resource "azurerm_role_assignment" "kv_deployer" {
  scope                = module.key_vault.key_vault_id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "time_sleep" "kv_deployer_propagation" {
  depends_on      = [azurerm_role_assignment.kv_deployer]
  create_duration = "60s"
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  value        = var.database_url
  key_vault_id = module.key_vault.key_vault_id

  depends_on = [time_sleep.kv_deployer_propagation]
}

resource "azurerm_key_vault_secret" "nextauth_secret" {
  name         = "nextauth-secret"
  value        = random_password.nextauth_secret.result
  key_vault_id = module.key_vault.key_vault_id

  depends_on = [time_sleep.kv_deployer_propagation]
}

resource "azurerm_key_vault_secret" "cron_secret" {
  name         = "cron-secret"
  value        = random_password.cron_secret.result
  key_vault_id = module.key_vault.key_vault_id

  depends_on = [time_sleep.kv_deployer_propagation]
}

resource "azurerm_key_vault_secret" "storage_connection_string" {
  name         = "storage-connection-string"
  value        = module.storage.primary_connection_string
  key_vault_id = module.key_vault.key_vault_id

  depends_on = [time_sleep.kv_deployer_propagation]
}

module "document_intelligence" {
  source = "../document_intelligence"

  project             = var.project
  environment         = var.environment
  location            = var.location
  resource_group_name = module.resource_group.resource_group_name
  key_vault_id        = module.key_vault.key_vault_id
  sku_name            = var.document_intelligence.sku_name
  tags                = local.common_tags

  depends_on = [time_sleep.kv_deployer_propagation]
}

module "communication_service" {
  source = "../communication_service"

  project             = var.project
  environment         = var.environment
  location            = var.location
  resource_group_name = module.resource_group.resource_group_name
  data_location       = var.communication_service.data_location
  key_vault_id        = module.key_vault.key_vault_id
  tags                = local.common_tags

  depends_on = [time_sleep.kv_deployer_propagation]
}

module "gotenberg" {
  source = "../gotenberg"

  project             = var.project
  environment         = var.environment
  location            = var.app_service_location
  resource_group_name = module.resource_group.resource_group_name
  key_vault_id        = module.key_vault.key_vault_id
  image               = var.gotenberg.image
  cpu                 = var.gotenberg.cpu
  memory              = var.gotenberg.memory
  tags                = local.common_tags

  depends_on = [time_sleep.kv_deployer_propagation]
}

module "ai_foundry" {
  source = "../ai_foundry"

  project                   = var.project
  environment               = var.environment
  location                  = var.location
  resource_group_name       = module.resource_group.resource_group_name
  key_vault_id              = module.key_vault.key_vault_id
  model_name                = var.ai_foundry.model_name
  model_version             = var.ai_foundry.model_version
  model_deployment_sku_name = var.ai_foundry.model_deployment_sku_name
  model_capacity            = var.ai_foundry.model_capacity
  tags                      = local.common_tags

  depends_on = [time_sleep.kv_deployer_propagation]
}

module "app_service" {
  source = "../app_service"

  project             = var.project
  environment         = var.environment
  location            = var.app_service_location
  resource_group_name = module.resource_group.resource_group_name
  sku_name            = var.app_service_sku
  https_only          = var.https_only
  tags                = local.common_tags

  docker_image = {
    name              = "${var.github_username}/${var.project}:${var.environment == "prod" ? "latest" : "dev-latest"}"
    registry_url      = "https://ghcr.io"
    registry_username = var.github_username
    registry_password = var.github_token
  }

  app_settings = merge(var.extra_app_settings, {
    "AZURE_STORAGE_CONNECTION_STRING"       = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.storage_connection_string.versionless_id})"
    "AZURE_STORAGE_CONTAINER_NAME"          = var.storage_container.name
    "NEXTAUTH_URL"                          = "https://app-${var.project}-${var.environment}-${local.app_service_location_short}.azurewebsites.net"
    "NEXTAUTH_SECRET"                       = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.nextauth_secret.versionless_id})"
    "DOCUMENT_INTELLIGENCE_ENDPOINT"        = "@Microsoft.KeyVault(SecretUri=${module.document_intelligence.document_intelligence_endpoint_secret_versionless_id})"
    "DOCUMENT_INTELLIGENCE_KEY"             = "@Microsoft.KeyVault(SecretUri=${module.document_intelligence.document_intelligence_key_secret_versionless_id})"
    "AZURE_COMMUNICATION_CONNECTION_STRING" = "@Microsoft.KeyVault(SecretUri=${module.communication_service.acs_connection_string_secret_versionless_id})"
    "ACS_SENDER_ADDRESS"                    = module.communication_service.sender_address
    "DATABASE_URL"                          = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.database_url.versionless_id})"
    "CRON_SECRET"                           = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.cron_secret.versionless_id})"
    "DEFAULT_ADMIN_EMAIL"                   = var.default_admin_email
    "GOTENBERG_URL"                         = module.gotenberg.url
    "GOTENBERG_BASIC_AUTH_USERNAME"         = "@Microsoft.KeyVault(SecretUri=${module.gotenberg.basic_auth_username_secret_versionless_id})"
    "GOTENBERG_BASIC_AUTH_PASSWORD"         = "@Microsoft.KeyVault(SecretUri=${module.gotenberg.basic_auth_password_secret_versionless_id})"
    "AI_FOUNDRY_ENDPOINT"                   = "@Microsoft.KeyVault(SecretUri=${module.ai_foundry.ai_foundry_endpoint_secret_versionless_id})"
    "AI_FOUNDRY_KEY"                        = "@Microsoft.KeyVault(SecretUri=${module.ai_foundry.ai_foundry_key_secret_versionless_id})"
    "AI_FOUNDRY_DEPLOYMENT_NAME"            = module.ai_foundry.deployment_name
  })
}

resource "azurerm_role_assignment" "kv_app_service" {
  scope                = module.key_vault.key_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = module.app_service.app_service_identity_principal_id
}

# Data source for current client config
data "azurerm_client_config" "current" {}
