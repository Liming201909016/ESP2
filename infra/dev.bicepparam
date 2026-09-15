using './main.bicep'

param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param environmentName = 'dev'
param location = 'southeastasia'
param azureAiLocation = 'eastus2'
param azureAiChatDeployment = 'gpt-chat-latest'
param azureAiEmbeddingDeployment = 'text-embedding-3-small'
