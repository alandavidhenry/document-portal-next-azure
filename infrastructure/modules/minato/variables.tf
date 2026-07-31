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

variable "document_intelligence" {
  description = "Document Intelligence configuration"
  type = object({
    sku_name = string
  })
  default = {
    sku_name = "F0"
  }
}

variable "app_service_sku" {
  description = "App Service plan SKU"
  type        = string
  default     = "B1"
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

variable "github_username" {
  description = "GitHub username for container registry"
  type        = string
  sensitive   = false
}

variable "github_token" {
  description = "GitHub personal access token with package read permissions"
  type        = string
  sensitive   = true
}

variable "allowed_origins" {
  description = "CORS allowed origins for storage account"
  type        = list(string)
  default     = []
}

variable "default_admin_email" {
  description = "Email of the default admin user"
  type        = string
  default     = ""
}

variable "extra_app_settings" {
  description = "Static app settings to merge with computed settings (Key Vault refs, URLs)"
  type        = map(string)
  default     = {}
}

variable "database_url" {
  description = "Neon PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "communication_service" {
  description = "Azure Communication Service configuration"
  type = object({
    data_location = string
  })
  default = {
    data_location = "Europe"
  }
}

variable "gotenberg" {
  description = "Gotenberg document conversion service configuration"
  type = object({
    image  = string
    cpu    = number
    memory = string
  })
  default = {
    image  = "docker.io/gotenberg/gotenberg:8"
    cpu    = 0.5
    memory = "1Gi"
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
