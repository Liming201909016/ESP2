type monitoredServices = {
  webApp: string
  appServicePlan: string
  appInsights: string
  workspace: string
  postgres: string
  search: string
  foundry: string
}

param location string = resourceGroup().location
param services monitoredServices
param enabled bool = true
@minLength(3)
@maxLength(5)
param testLocations string[] = ['apac-sg-sin-azr', 'apac-hk-hkn-azr', 'us-ca-sjc-azr']

var commonTags = {
  application: 'ESP'
  environment: 'dev'
  managedBy: 'Bicep'
  costCenter: 'ESP-DEV'
}

resource webApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: services.webApp
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' existing = {
  name: services.appServicePlan
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: services.appInsights
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: services.workspace
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: services.postgres
}

resource search 'Microsoft.Search/searchServices@2023-11-01' existing = {
  name: services.search
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: services.foundry
}

resource consoleDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: webApp
  name: 'esp-operational-console'
  properties: {
    workspaceId: workspace.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: enabled
      }
    ]
    metrics: []
  }
}

var availabilityChecks = [
  {
    name: 'esp-dev-home'
    path: '/'
    content: 'Enterprise Skill Platform'
    description: 'Public DEV homepage, HTTPS and certificate availability. No model or business mutation.'
  }
  {
    name: 'esp-dev-readiness'
    path: '/api/readiness'
    content: '"status":"ready"'
    description: 'Cached Blob, Search sentinel and selected SQL dependency readiness. Does not test the model or write permissions.'
  }
]

resource availabilityTests 'Microsoft.Insights/webtests@2022-06-15' = [for check in availabilityChecks: {
  name: check.name
  location: location
  kind: 'standard'
  tags: union(commonTags, { 'hidden-link:${appInsights.id}': 'Resource' })
  properties: {
    Name: check.name
    SyntheticMonitorId: check.name
    Description: check.description
    Enabled: enabled
    Kind: 'standard'
    Frequency: 300
    Timeout: 30
    RetryEnabled: true
    Locations: [for testLocation in testLocations: { Id: testLocation }]
    Request: {
      RequestUrl: 'https://${webApp.properties.defaultHostName}${check.path}'
      HttpVerb: 'GET'
      FollowRedirects: false
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: check.content
        IgnoreCase: false
        PassIfTextFound: true
      }
    }
  }
}]

resource availabilityAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for (check, index) in availabilityChecks: {
  name: 'alert-${check.name}-unavailable'
  location: 'global'
  tags: commonTags
  properties: {
    description: '${check.description} Alert when at least two test locations fail. Portal only.'
    severity: 1
    enabled: enabled
    autoMitigate: true
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [availabilityTests[index].id, appInsights.id]
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: availabilityTests[index].id
      componentId: appInsights.id
      failedLocationCount: 2
    }
    actions: []
  }
}]

var resourceLocations = {
  'Microsoft.Web/sites': webApp.location
  'Microsoft.Web/serverfarms': appServicePlan.location
  'Microsoft.DBforPostgreSQL/flexibleServers': postgres.location
  'Microsoft.Search/searchServices': search.location
  'Microsoft.CognitiveServices/accounts': foundry.location
}

var metricRules = [
  { name: 'web-http5xx', resource: webApp.id, namespace: 'Microsoft.Web/sites', metric: 'Http5xx', aggregation: 'Total', threshold: 5, window: 'PT5M', description: 'At least 5 HTTP 5xx responses in 5 minutes, including readiness 503.' }
  { name: 'plan-cpu', resource: appServicePlan.id, namespace: 'Microsoft.Web/serverfarms', metric: 'CpuPercentage', aggregation: 'Average', threshold: 80, window: 'PT15M', description: 'App Service plan average CPU is at least 80 percent over 15 minutes.' }
  { name: 'plan-memory', resource: appServicePlan.id, namespace: 'Microsoft.Web/serverfarms', metric: 'MemoryPercentage', aggregation: 'Average', threshold: 85, window: 'PT15M', description: 'App Service plan average memory is at least 85 percent over 15 minutes.' }
  { name: 'postgres-cpu', resource: postgres.id, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'cpu_percent', aggregation: 'Average', threshold: 80, window: 'PT15M', description: 'PostgreSQL average CPU is at least 80 percent over 15 minutes.' }
  { name: 'postgres-storage', resource: postgres.id, namespace: 'Microsoft.DBforPostgreSQL/flexibleServers', metric: 'storage_percent', aggregation: 'Average', threshold: 85, window: 'PT15M', description: 'PostgreSQL average storage usage is at least 85 percent over 15 minutes.' }
  { name: 'search-latency', resource: search.id, namespace: 'Microsoft.Search/searchServices', metric: 'SearchLatency', aggregation: 'Average', threshold: 2, window: 'PT15M', description: 'Search average latency is at least 2 seconds over 15 minutes.' }
  { name: 'search-throttling', resource: search.id, namespace: 'Microsoft.Search/searchServices', metric: 'ThrottledSearchQueriesPercentage', aggregation: 'Average', threshold: 5, window: 'PT15M', description: 'Search throttled-query percentage averages at least 5 percent over 15 minutes.' }
  { name: 'foundry-server-errors', resource: foundry.id, namespace: 'Microsoft.CognitiveServices/accounts', metric: 'ServerErrors', aggregation: 'Total', threshold: 3, window: 'PT5M', description: 'At least 3 Foundry server errors in 5 minutes; only observes real traffic.' }
  { name: 'foundry-blocked-calls', resource: foundry.id, namespace: 'Microsoft.CognitiveServices/accounts', metric: 'BlockedCalls', aggregation: 'Total', threshold: 5, window: 'PT5M', description: 'At least 5 Foundry blocked calls in 5 minutes; no synthetic model calls are scheduled.' }
]

resource metricAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for rule in metricRules: {
  name: 'alert-esp-dev-${rule.name}'
  location: 'global'
  tags: commonTags
  properties: {
    description: '${rule.description} Portal only; investigate before scaling or retrying business operations.'
    severity: 2
    enabled: enabled
    autoMitigate: true
    evaluationFrequency: 'PT1M'
    windowSize: rule.window
    scopes: [rule.resource]
    targetResourceType: rule.namespace
    targetResourceRegion: resourceLocations[rule.namespace]
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: rule.name
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: rule.namespace
          metricName: rule.metric
          operator: 'GreaterThanOrEqual'
          timeAggregation: rule.aggregation
          threshold: rule.threshold
          skipMetricValidation: false
        }
      ]
    }
    actions: []
  }
}]

var operationQuery = '''
union isfuzzy=true AppServiceConsoleLogs, (datatable(TimeGenerated:datetime, _ResourceId:string, ResultDescription:string) [])
| where TimeGenerated > ago(10m) and _ResourceId =~ '__WEB_APP_RESOURCE_ID__'
| extend PayloadStart = indexof(ResultDescription, '{"event":"esp.operation"')
| where PayloadStart >= 0
| extend Event = parse_json(substring(ResultDescription, PayloadStart))
| where tostring(Event.event) == 'esp.operation' and tostring(Event.service) == 'esp-platform' and toint(Event.schemaVersion) == 1
'''
var scopedOperationQuery = replace(operationQuery, '__WEB_APP_RESOURCE_ID__', webApp.id)
var logRules = [
  {
    name: 'operation-failures'
    description: 'At least 3 failed or unavailable business operations in 10 minutes. Expected no-evidence, confirmation and approval states are not failures.'
    predicate: '| where toint(Event.httpStatus) >= 500 or tostring(Event.outcome) in ("failed", "error", "unavailable", "execution_unknown")'
    threshold: 3
  }
  {
    name: 'audit-degraded'
    description: 'At least 1 unavailable or incomplete audit receipt in 10 minutes. Do not replay a successful business mutation to repair its audit.'
    predicate: '| where tostring(Event.auditStatus) in ("unavailable", "incomplete")'
    threshold: 1
  }
]

resource operationalAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for rule in logRules: {
  name: 'alert-esp-dev-${rule.name}'
  location: location
  kind: 'LogAlert'
  tags: commonTags
  properties: {
    displayName: 'ESP DEV ${rule.name}'
    description: '${rule.description} Portal only. Console ingestion is asynchronous; no events is not proof of health.'
    enabled: enabled
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    scopes: [workspace.id]
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    skipQueryValidation: false
    criteria: {
      allOf: [
        {
          query: '${scopedOperationQuery}\n${rule.predicate}\n| project TimeGenerated, RequestId=tostring(Event.requestId), Outcome=tostring(Event.outcome), AuditStatus=tostring(Event.auditStatus)'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: rule.threshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: { actionGroups: [] }
  }
}]

output availabilityTestIds string[] = [for (check, index) in availabilityChecks: availabilityTests[index].id]
output metricAlertIds string[] = [for (rule, index) in metricRules: metricAlerts[index].id]
output operationalAlertIds string[] = [for (rule, index) in logRules: operationalAlerts[index].id]
output operationalEventQuery string = scopedOperationQuery
