const {
  map,
  isNil,
  isEmpty,
  find,
  reduce,
  pipe,
  concat,
  not,
  equals,
  toPairs,
  flatten
} = require('ramda')
const { getAccountId, defaultToAnArray } = require('.')

const createServiceRole = async (awsIamRole, config, debug) => {
  const accountId = await getAccountId()
  const statements = pipe(
    reduce((acc, dataSource) => {
      if (isNil(dataSource.serviceRoleArn)) {
        if (not(acc[dataSource.type])) {
          acc[dataSource.type] = []
        }
        const existingItem = find(
          (config) => equals(config, dataSource.config),
          acc[dataSource.type]
        )
        if (isNil(existingItem)) {
          acc[dataSource.type] = concat(acc[dataSource.type], [dataSource.config])
        }
      }
      return acc
    }, {}),
    toPairs,
    map(([type, dataSourceConfigs]) => {
      switch (type) {
        case 'AWS_LAMBDA':
          return [
            {
              Action: ['lambda:invokeFunction'],
              Effect: 'Allow',
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    dataSourceConfig.lambdaFunctionArn,
                    `${dataSourceConfig.lambdaFunctionArn}:*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        case 'AMAZON_DYNAMODB':
          return [
            {
              Action: [
                'dynamodb:DeleteItem',
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:Scan',
                'dynamodb:UpdateItem',
                'dynamodb:BatchGetItem',
                'dynamodb:BatchWriteItem'
              ],
              Effect: 'Allow',
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    `arn:aws:dynamodb:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:table/${
                      dataSourceConfig.tableName
                    }`,
                    `arn:aws:dynamodb:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:table/${
                      dataSourceConfig.tableName
                    }/*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        case 'AMAZON_ELASTICSEARCH':
          return [
            {
              Action: [
                'es:ESHttpDelete',
                'es:ESHttpGet',
                'es:ESHttpHead',
                'es:ESHttpPost',
                'es:ESHttpPut'
              ],
              Effect: 'Allow',
              Resource: map((dataSourceConfig) => {
                const result = /^https:\/\/([a-z0-9\-]+\.\w{2}\-[a-z]+\-\d\.es\.amazonaws\.com)$/.exec(
                  dataSourceConfig.endpoint
                )
                return `arn:aws:es:${dataSourceConfig.region ||
                  config.region}:${dataSourceConfig.accountId || accountId}:domain/${result[1]}`
              }, dataSourceConfigs)
            }
          ]
        case 'RELATIONAL_DATABASE':
          return [
            {
              Effect: 'Allow',
              Action: [
                'rds-data:DeleteItems',
                'rds-data:ExecuteSql',
                'rds-data:GetItems',
                'rds-data:InsertItems',
                'rds-data:UpdateItems'
              ],
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    `arn:aws:rds:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:cluster:${
                      dataSourceConfig.dbClusterIdentifier
                    }`,
                    `arn:aws:rds:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:cluster:${
                      dataSourceConfig.dbClusterIdentifier
                    }:*`
                  ],
                  dataSourceConfigs
                )
              )
            },
            {
              Effect: 'Allow',
              Action: ['secretsmanager:GetSecretValue'],
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    dataSourceConfig.awsSecretStoreArn,
                    `${dataSourceConfig.awsSecretStoreArn}:*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        default:
          break
      }
    }),
    flatten
  )(defaultToAnArray(config.dataSources))
  if (not(isEmpty(statements))) {
    const role = await awsIamRole({
      service: 'appsync.amazonaws.com',
      policy: {
        Version: '2012-10-17',
        Statement: statements
      },
      region: config.region
    })
    return role
  }
}

module.exports = {
  createServiceRole
}
