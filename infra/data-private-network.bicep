type dataServiceNames = {
  search: string
  postgres: string
  foundry: string
}

param location string = resourceGroup().location
param virtualNetworkName string
param services dataServiceNames

var commonTags = {
  application: 'ESP'
  environment: 'dev'
  managedBy: 'Bicep'
  costCenter: 'ESP-DEV'
}

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: virtualNetworkName
}

resource endpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: virtualNetwork
  name: 'private-endpoints'
}

resource search 'Microsoft.Search/searchServices@2023-11-01' existing = {
  name: services.search
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: services.postgres
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: services.foundry
}

var privateDnsZoneNames = [
  'privatelink.search.windows.net'
  'privatelink.postgres.database.azure.com'
  'privatelink.cognitiveservices.azure.com'
  'privatelink.openai.azure.com'
  'privatelink.services.ai.azure.com'
]

var endpointConfigurations = [
  {
    name: 'pe-${services.search}-search'
    targetId: search.id
    groupId: 'searchService'
    zoneIndexes: [0]
  }
  {
    name: 'pe-${services.postgres}-postgres'
    targetId: postgres.id
    groupId: 'postgresqlServer'
    zoneIndexes: [1]
  }
  {
    name: 'pe-${services.foundry}-account'
    targetId: foundry.id
    groupId: 'account'
    zoneIndexes: [2, 3, 4]
  }
]

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for zoneName in privateDnsZoneNames: {
  name: zoneName
  location: 'global'
  tags: commonTags
}]

resource privateDnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (zoneName, zoneIndex) in privateDnsZoneNames: {
  parent: privateDnsZones[zoneIndex]
  name: 'link-${virtualNetworkName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}]

resource privateEndpoints 'Microsoft.Network/privateEndpoints@2024-05-01' = [for endpoint in endpointConfigurations: {
  name: endpoint.name
  location: location
  tags: commonTags
  properties: {
    subnet: {
      id: endpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: endpoint.groupId
        properties: {
          privateLinkServiceId: endpoint.targetId
          groupIds: [endpoint.groupId]
        }
      }
    ]
  }
}]

resource privateDnsZoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (endpoint, endpointIndex) in endpointConfigurations: {
  parent: privateEndpoints[endpointIndex]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [for zoneIndex in endpoint.zoneIndexes: {
      name: 'zone-${zoneIndex}'
      properties: {
        privateDnsZoneId: privateDnsZones[zoneIndex].id
      }
    }]
  }
}]

output privateEndpointIds string[] = [for (endpoint, endpointIndex) in endpointConfigurations: privateEndpoints[endpointIndex].id]
output dnsZoneNames string[] = privateDnsZoneNames
