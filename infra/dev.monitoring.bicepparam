using './monitoring.bicep'

param location = 'southeastasia'
param services = {
  webApp: 'app-esp-dev-ygxkqw7r'
  appServicePlan: 'asp-esp-dev-ygxkqw7r'
  appInsights: 'appi-esp-dev-ygxkqw7r'
  workspace: 'log-esp-dev-ygxkqw7r'
  postgres: 'psql-esp-dev-ygxkqw7r'
  search: 'srch-esp-dev-ygxkqw7r'
  foundry: 'aif-esp-dev-ygxkqw7r'
}
