# Azure AI Foundry account (Cognitive Services, kind = "AIServices") hosting
# a single serverless model deployment used to generate draft comprehension
# questions from uploaded H&S documents. Generation only happens when Simon
# (or a Customer Admin) publishes a template, so volume is tiny - a
# GlobalStandard (pay-per-token, no reserved capacity) deployment of the
# cheapest available model tier is the appropriate SKU, not provisioned
# throughput. Generated questions are never auto-published - see the
# human-review gate noted in future-considerations.md.

locals {
  location_short = {
    "UK South" = "uks"
    "uksouth"  = "uks"
    "UK West"  = "ukw"
    "ukwest"   = "ukw"
  }[var.location]
  name = "aif-${var.project}-${var.environment}-${local.location_short}"
}

resource "azurerm_cognitive_account" "ai_foundry" {
  name                  = local.name
  location              = var.location
  resource_group_name   = var.resource_group_name
  kind                  = "AIServices"
  sku_name              = var.sku_name
  custom_subdomain_name = local.name
  tags                  = var.tags
}

resource "azurerm_cognitive_deployment" "comprehension_questions" {
  name                 = "comprehension-questions"
  cognitive_account_id = azurerm_cognitive_account.ai_foundry.id

  model {
    format  = "OpenAI"
    name    = var.model_name
    version = var.model_version
  }

  sku {
    name     = var.model_deployment_sku_name
    capacity = var.model_capacity
  }

  version_upgrade_option = var.model_version_upgrade_option
}

resource "azurerm_key_vault_secret" "ai_foundry_endpoint" {
  name         = "ai-foundry-endpoint"
  value        = azurerm_cognitive_account.ai_foundry.endpoint
  key_vault_id = var.key_vault_id
}

resource "azurerm_key_vault_secret" "ai_foundry_key" {
  name         = "ai-foundry-key"
  value        = azurerm_cognitive_account.ai_foundry.primary_access_key
  key_vault_id = var.key_vault_id
  content_type = "text/plain"
}
