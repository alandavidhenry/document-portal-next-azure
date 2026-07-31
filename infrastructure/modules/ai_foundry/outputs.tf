output "ai_foundry_id" {
  description = "The ID of the AI Foundry (Cognitive Services) account"
  value       = azurerm_cognitive_account.ai_foundry.id
}

output "ai_foundry_endpoint" {
  description = "The endpoint of the AI Foundry account"
  value       = azurerm_cognitive_account.ai_foundry.endpoint
}

output "deployment_name" {
  description = "The deployment name to use as the model/engine identifier when calling the API"
  value       = azurerm_cognitive_deployment.comprehension_questions.name
}

output "ai_foundry_primary_key" {
  description = "The primary access key for the AI Foundry account"
  value       = azurerm_cognitive_account.ai_foundry.primary_access_key
  sensitive   = true
}

output "ai_foundry_endpoint_secret_versionless_id" {
  description = "The versionless ID of the AI Foundry endpoint secret"
  value       = azurerm_key_vault_secret.ai_foundry_endpoint.versionless_id
}

output "ai_foundry_key_secret_versionless_id" {
  description = "The versionless ID of the AI Foundry key secret"
  value       = azurerm_key_vault_secret.ai_foundry_key.versionless_id
}
