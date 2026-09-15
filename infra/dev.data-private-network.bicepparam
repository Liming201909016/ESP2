using './data-private-network.bicep'

param location = 'southeastasia'
param virtualNetworkName = 'vnet-esp-dev-ygxkqw7r'
param services = {
  search: 'srch-esp-dev-ygxkqw7r'
  postgres: 'psql-esp-dev-ygxkqw7r'
  foundry: 'aif-esp-dev-ygxkqw7r'
}
