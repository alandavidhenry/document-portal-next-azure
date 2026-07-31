variable "project" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "location" {
  description = "Azure region"
  type        = string
}

variable "app_service_location" {
  description = "Azure region for the App Service Plan and Web App"
  type        = string
  default     = "UK West"
}

variable "resource_group_name" {
  description = "Resource group name"
  type        = string
  default     = null
}

variable "app_service_sku" {
  description = "App Service plan SKU"
  type        = string
}

variable "https_only" {
  description = "Force HTTPS for all traffic"
  type        = bool
  default     = true
}

variable "key_vault" {
  description = "Key Vault configuration"
  type = object({
    sku_name = string
  })
}

variable "storage" {
  description = "Storage account configuration"
  type = object({
    account_tier             = string
    account_replication_type = string
    min_tls_version          = string
  })
}

variable "storage_container" {
  description = "Storage container configuration"
  type = object({
    name                  = string
    container_access_type = string
  })
}

variable "document_intelligence" {
  description = "Document Intelligence configuration"
  type = object({
    sku_name = string
  })
  default = {
    sku_name = "F0"
  }
}

variable "ai_foundry" {
  description = "AI Foundry account + model deployment configuration (comprehension question generation)"
  type = object({
    model_name                = string
    model_version             = string
    model_deployment_sku_name = optional(string, "GlobalStandard")
    model_capacity            = optional(number, 1)
  })
}

variable "github_username" {
  description = "GitHub username for container registry"
  type        = string
}

variable "github_token" {
  description = "GitHub personal access token with package read permissions"
  type        = string
  sensitive   = true
}

variable "default_admin_email" {
  description = "Email of the default admin user"
  type        = string
  default     = ""
}

variable "extra_app_settings" {
  description = "Static app settings to merge with computed settings"
  type        = map(string)
  default     = {}
}

variable "database_url" {
  description = "Neon PostgreSQL connection string"
  type        = string
  sensitive   = true
}
