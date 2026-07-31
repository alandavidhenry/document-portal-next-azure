project              = "minato"
environment          = "dev"
location             = "UK South"
app_service_location = "UK West"
github_username      = "alandavidhenry"

app_service_sku = "F1"
https_only      = false

key_vault = {
  sku_name = "standard"
}

storage = {
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

storage_container = {
  name                  = "documents"
  container_access_type = "private"
}

document_intelligence = {
  sku_name = "F0"
}

ai_foundry = {
  model_name    = "gpt-5.4-nano"
  model_version = "2026-03-17"
}

default_admin_email = "alandavidhenry@outlook.com"

extra_app_settings = {
  # Storage proxy host for dev blob accessIm
  "AZURE_STORAGE_PROXY_HOST"            = "stminatodevuks01.blob.core.windows.net"
  "SCM_DO_BUILD_DURING_DEPLOYMENT"      = "true"
  "WEBSITE_NODE_DEFAULT_VERSION"        = "~24"
  "WEBSITES_CONTAINER_START_TIME_LIMIT" = "600"
  "WEBSITES_ENABLE_APP_SERVICE_STORAGE" = "true"
  "WEBSITES_PORT"                       = "8080"
}
