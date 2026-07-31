output "resource_group_name" {
  description = "The name of the resource group"
  value       = module.resource_group.resource_group_name
}

output "app_service_name" {
  description = "The name of the App Service"
  value       = module.app_service.app_service_name
}

output "app_service_url" {
  description = "The URL of the App Service"
  value       = module.app_service.app_service_url
}

output "storage_connection_string" {
  description = "Storage account connection string"
  value       = module.storage.primary_connection_string
  sensitive   = true
}

output "storage_container_name" {
  description = "Storage container name"
  value       = var.storage_container.name
}

output "nextauth_secret" {
  description = "NextAuth secret"
  value       = random_password.nextauth_secret.result
  sensitive   = true
}

output "cron_secret" {
  description = "Cron secret — copy this value into the CRON_SECRET GitHub Actions secret for the prod environment"
  value       = random_password.cron_secret.result
  sensitive   = true
}

output "key_vault_name" {
  description = "The name of the Key Vault"
  value       = module.key_vault.key_vault_name
}

output "document_intelligence_endpoint" {
  description = "The endpoint of the Document Intelligence service"
  value       = module.document_intelligence.document_intelligence_endpoint
}

output "document_intelligence_key" {
  description = "The primary key of the Document Intelligence service"
  value       = module.document_intelligence.document_intelligence_primary_key
  sensitive   = true
}

output "acs_sender_address" {
  description = "The Azure-managed sender email address for transactional emails"
  value       = module.communication_service.sender_address
}

output "ai_foundry_endpoint" {
  description = "The endpoint of the AI Foundry account"
  value       = module.ai_foundry.ai_foundry_endpoint
}

output "ai_foundry_deployment_name" {
  description = "The deployment name to use as the model/engine identifier when calling the API"
  value       = module.ai_foundry.deployment_name
}
