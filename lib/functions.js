const { difference, equals, find, isNil, merge, not, pick, map } = require('ramda')

const { equalsByKeys, listAll, defaultToAnArray, readIfFile, checkForDuplicates } = require('.')

const createOrUpdateFunctions = async (appSync, config, debug) => {
  checkForDuplicates(['name', 'dataSource'], defaultToAnArray(config.functions))
  const deployedFunctions = await listAll(
    appSync,
    'listFunctions',
    { apiId: config.apiId },
    'functions'
  )

  const functionsWithTemplates = await Promise.all(
    map(async (func) => {
      const requestMappingTemplate = await readIfFile(func.request)
      const responseMappingTemplate = await readIfFile(func.response)
      return merge(func, {
        requestMappingTemplate,
        responseMappingTemplate,
        dataSourceName: func.dataSource
      })
    }, defaultToAnArray(config.functions))
  )

  const functionsToDeploy = map((func) => {
    const deployedFunction = find(
      ({ name, dataSourceName }) =>
        equals(name, func.name) && equals(dataSourceName, func.dataSourceName),
      deployedFunctions
    )
    const functionEquals = isNil(deployedFunction)
      ? false
      : equalsByKeys(
          ['dataSourceName', 'name', 'responseMappingTemplate', 'requestMappingTemplate'],
          deployedFunction,
          func
        )
    const mode = not(functionEquals) ? (not(deployedFunction) ? 'create' : 'update') : 'ignore'
    return merge(func, {
      mode,
      functionId: deployedFunction ? deployedFunction.functionId : undefined
    })
  }, functionsWithTemplates)

  return Promise.all(
    map(async (func) => {
      const params = {
        apiId: config.apiId,
        name: func.name,
        requestMappingTemplate: func.requestMappingTemplate,
        responseMappingTemplate: func.responseMappingTemplate,
        functionVersion: func.functionVersion || '2018-05-29',
        dataSourceName: func.dataSource,
        description: func.description
      }
      if (equals(func.mode, 'create')) {
        debug(`Creating function ${func.name}`)
        const { functionConfiguration } = await appSync.createFunction(params).promise()
        func.functionId = functionConfiguration.functionId
      } else if (equals(func.mode, 'update')) {
        debug(`Updating function ${func.name}`)
        await appSync.updateFunction(merge(params, { functionId: func.functionId })).promise()
      }
      return Promise.resolve(func)
    }, functionsToDeploy)
  )
}

const removeObsoleteFunctions = async (appSync, config, state, debug) => {
  const obsoleteFunctions = difference(
    map(pick(['name', 'dataSource']), defaultToAnArray(state.functions)),
    map(pick(['name', 'dataSource']), defaultToAnArray(config.functions))
  )
  await Promise.all(
    map(async (func) => {
      const { functionId } = find(
        ({ name, dataSource }) => equals(name, func.name) && equals(dataSource, func.dataSource),
        state.functions
      )
      debug(`Removing function ${func.name}`)
      try {
        await appSync
          .deleteFunction({
            apiId: config.apiId,
            functionId
          })
          .promise()
      } catch (error) {
        if (not(equals(error.code, 'NotFoundException'))) {
          throw error
        }
        debug(`Function ${func.name} already removed`)
      }
    }, obsoleteFunctions)
  )
}

module.exports = {
  createOrUpdateFunctions,
  removeObsoleteFunctions
}
