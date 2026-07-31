variable "project" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "resource_group_name" {
  description = "The name of the resource group"
  type        = string
}

variable "location" {
  description = "Azure region for the AI Foundry (Cognitive Services) account"
  type        = string
}

variable "sku_name" {
  description = "SKU of the Cognitive Services account itself (S0 is the only standard pay-as-you-go tier — actual usage cost comes from the per-model deployment, not this)"
  type        = string
  default     = "S0"
}

variable "model_name" {
  description = "Catalog model name to deploy, e.g. gpt-5.4-nano (confirm the exact id in the Azure AI Foundry model catalog before applying)"
  type        = string
}

variable "model_version" {
  description = "Model version string as shown on the catalog's model card"
  type        = string
}

variable "model_deployment_sku_name" {
  description = "Deployment SKU — GlobalStandard is the cheapest serverless pay-per-token option with no reserved capacity; DataZoneStandard/Standard pin to a specific region/data zone instead"
  type        = string
  default     = "GlobalStandard"
}

variable "model_capacity" {
  description = "Deployment capacity in units of 1,000 tokens-per-minute. Only meaningful for pinned regional SKUs (rate-limits burst throughput) - keep low since this workload is low-volume (template publish only)"
  type        = number
  default     = 1
}

variable "model_version_upgrade_option" {
  description = "What happens when this model version is retired. NoAutoUpgrade prevents Azure silently swapping the deployed model (and its cost/behaviour) out from under you; you upgrade deliberately instead"
  type        = string
  default     = "NoAutoUpgrade"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

variable "key_vault_id" {
  description = "The ID of the Key Vault to store secrets"
  type        = string
}
