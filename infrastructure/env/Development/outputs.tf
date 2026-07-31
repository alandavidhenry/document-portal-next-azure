output "resource_group_name" {
  description = "The name of the resource group"
  value       = module.minato.resource_group_name
}

output "app_service_name" {
  description = "The name of the App Service"
  value       = module.minato.app_service_name
}

output "app_service_url" {
  description = "The URL of the App Service"
  value       = module.minato.app_service_url
}

output "storage_connection_string" {
  description = "Storage account connection string"
  value       = module.minato.storage_connection_string
  sensitive   = true
}

output "storage_container_name" {
  description = "Storage container name"
  value       = module.minato.storage_container_name
}

output "nextauth_secret" {
  description = "NextAuth secret"
  value       = module.minato.nextauth_secret
  sensitive   = true
}

output "cron_secret" {
  description = "Cron secret — copy into CRON_SECRET GitHub Actions secret for the dev environment"
  value       = module.minato.cron_secret
  sensitive   = true
}

output "key_vault_name" {
  description = "The name of the Key Vault"
  value       = module.minato.key_vault_name
}

output "document_intelligence_endpoint" {
  description = "The endpoint of the Document Intelligence service"
  value       = module.minato.document_intelligence_endpoint
}

output "document_intelligence_key" {
  description = "The primary key of the Document Intelligence service"
  value       = module.minato.document_intelligence_key
  sensitive   = true
}

output "ai_foundry_endpoint" {
  description = "The endpoint of the AI Foundry account"
  value       = module.minato.ai_foundry_endpoint
}

output "ai_foundry_deployment_name" {
  description = "The deployment name to use as the model/engine identifier when calling the API"
  value       = module.minato.ai_foundry_deployment_name
}
