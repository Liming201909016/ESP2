@description('Deployment environment name.')
@minLength(2)
@maxLength(8)
param environmentName string = 'dev'

@description('Primary region for ESP application and data services.')
param location string = resourceGroup().location

@secure()
@description('Initial PostgreSQL administrator password. Pass at deployment time; never store in a parameter file.')
param postgresAdminPassword string

@description('Region for Azure AI Foundry and model deployments.')
param azureAiLocation string = 'eastus2'

param azureAiChatDeployment string = 'gpt-chat-latest'
param azureAiEmbeddingDeployment string = 'text-embedding-3-small'

var suffix = take(uniqueString(subscription().id, resourceGroup().id, environmentName), 8)
var prefix = 'esp-${environmentName}'
var storageName = replace('${prefix}${suffix}', '-', '')
var keyVaultName = take('${prefix}-${suffix}-kv', 24)
var searchName = 'srch-${prefix}-${suffix}'
var postgresName = 'psql-${prefix}-${suffix}'
var planName = 'asp-${prefix}-${suffix}'
var webAppName = 'app-${prefix}-${suffix}'
var workspaceName = 'log-${prefix}-${suffix}'
var appInsightsName = 'appi-${prefix}-${suffix}'
var azureAiAccountName = 'aif-${prefix}-${suffix}'
var azureAiProjectName = '${prefix}-project'
var virtualNetworkName = 'vnet-${prefix}-${suffix}'
var blobPrivateEndpointName = 'pe-${storageName}-blob'
var commonTags = {
  application: 'ESP'
  environment: environmentName
  managedBy: 'Bicep'
  costCenter: 'ESP-DEV'
}

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: virtualNetworkName
  location: location
  tags: commonTags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.40.0.0/24']
    }
    subnets: [
      {
        name: 'app-integration'
        properties: {
          addressPrefix: '10.40.0.0/26'
          delegations: [
            {
              name: 'web-app-delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.40.0.64/26'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appIntegrationSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: virtualNetwork
  name: 'app-integration'
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: virtualNetwork
  name: 'private-endpoints'
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: commonTags
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: commonTags
  properties: {
    Application_Type: 'web'
    IngestionMode: 'LogAnalytics'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: commonTags
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: commonTags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource auditContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'audit'
  properties: {
    publicAccess: 'None'
  }
}

resource blobPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: commonTags
}

resource blobPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobPrivateDnsZone
  name: 'link-${virtualNetworkName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: blobPrivateEndpointName
  location: location
  tags: commonTags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource blobPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobPrivateDnsZone.id
        }
      }
    ]
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    tenantId: tenant().tenantId
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchName
  location: location
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'basic'
  }
  properties: {
    disableLocalAuth: true
    hostingMode: 'default'
    partitionCount: 1
    publicNetworkAccess: 'disabled'
    replicaCount: 1
    semanticSearch: 'free'
  }
}

resource azureAiAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: azureAiAccountName
  location: azureAiLocation
  kind: 'AIServices'
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: azureAiAccountName
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
  }
}

resource azureAiProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: azureAiAccount
  name: azureAiProjectName
  location: azureAiLocation
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: azureAiAccount
  name: azureAiChatDeployment
  dependsOn: [azureAiProject]
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-chat-latest'
      version: '2026-08-06'
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: azureAiAccount
  name: azureAiEmbeddingDeployment
  dependsOn: [chatDeployment]
  sku: {
    name: 'Standard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-small'
      version: '1'
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: 'espadmin'
    administratorLoginPassword: postgresAdminPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: 32
    }
    version: '16'
  }
}

module dataPrivateNetwork './data-private-network.bicep' = {
  params: {
    location: location
    virtualNetworkName: virtualNetwork.name
    services: {
      search: search.name
      postgres: postgres.name
      foundry: azureAiAccount.name
    }
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource espDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'esp'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  tags: commonTags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    clientAffinityEnabled: false
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: appServicePlan.id
    virtualNetworkSubnetId: appIntegrationSubnet.id
    siteConfig: {
      appCommandLine: 'node server.js'
      alwaysOn: true
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      http20Enabled: true
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
      vnetRouteAllEnabled: true
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~24' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
        { name: 'ESP_ENVIRONMENT', value: environmentName }
        { name: 'AZURE_AI_ENDPOINT', value: azureAiAccount.properties.endpoints['OpenAI Language Model Instance API'] }
        { name: 'AZURE_AI_CHAT_DEPLOYMENT', value: azureAiChatDeployment }
        { name: 'AZURE_AI_EMBEDDING_DEPLOYMENT', value: azureAiEmbeddingDeployment }
        { name: 'AZURE_SEARCH_ENDPOINT', value: 'https://${search.name}.search.windows.net' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
        { name: 'KEY_VAULT_URI', value: keyVault.properties.vaultUri }
        { name: 'POSTGRES_HOST', value: postgres.properties.fullyQualifiedDomainName }
        { name: 'POSTGRES_DATABASE', value: 'esp' }
        { name: 'POSTGRES_USER', value: 'espadmin' }
        { name: 'POSTGRES_PASSWORD', value: '@Microsoft.KeyVault(SecretUri=${postgresPasswordSecret.properties.secretUriWithVersion})' }
      ]
    }
  }
}

output webAppName string = webApp.name
output webAppHostName string = webApp.properties.defaultHostName
output webAppPrincipalId string = webApp.identity.principalId
output storageAccountName string = storage.name
output keyVaultName string = keyVault.name
output searchServiceName string = search.name
output postgresServerName string = postgres.name
output azureAiAccountName string = azureAiAccount.name
output azureAiProjectName string = azureAiProject.name
output azureAiEndpoint string = azureAiAccount.properties.endpoints['OpenAI Language Model Instance API']
output resourceNames object = {
  appServicePlan: appServicePlan.name
  applicationInsights: appInsights.name
  logAnalytics: logAnalytics.name
}
