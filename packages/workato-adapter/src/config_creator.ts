/*
 *                      Copyright 2024 Salto Labs Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  BuiltinTypes,
  CORE_ANNOTATIONS,
  ConfigCreator,
  ElemID,
  InstanceElement,
  createRestriction,
} from '@salto-io/adapter-api'
import {
  createDefaultInstanceFromType,
  createMatchingObjectType,
  createOptionsTypeGuard,
} from '@salto-io/adapter-utils'
import { ENABLE_DEPLOY_SUPPORT_FLAG, configType } from './config'
import { WORKATO } from './constants'

const optionsElemId = new ElemID(WORKATO, 'configOptionsType')

const WORKATO_DEPLOY_OPTION = 'Deploy'
const WORKATO_IMPACT_ANALYSIS_OPTION = 'Impact Analysis'

type ConfigOptionsType = {
  useCase?: string
}

export const optionsType = createMatchingObjectType<ConfigOptionsType>({
  elemID: optionsElemId,
  fields: {
    useCase: {
      refType: BuiltinTypes.STRING,
      annotations: {
        [CORE_ANNOTATIONS.DEFAULT]: WORKATO_DEPLOY_OPTION,
        [CORE_ANNOTATIONS.REQUIRED]: true,
        [CORE_ANNOTATIONS.ALIAS]: 'Choose your Workato use case',
        [CORE_ANNOTATIONS.RESTRICTION]: createRestriction({
          values: [WORKATO_DEPLOY_OPTION, WORKATO_IMPACT_ANALYSIS_OPTION],
          enforce_value: true,
        }),
        [CORE_ANNOTATIONS.DESCRIPTION]: `## Customize Your Workato Use Case

### Deploy
Deploy recipes and move changes between environments.
        
Connecting to additional applications is not available in this mode.
        
### Impact Analysis
Connect Workato to additional applications such as Salesforce, Netsuite, Jira, and more to analyze dependencies between your Workato recipes and these applications.
        
[Learn more about this feature](https://help.salto.io/en/articles/6933980-salto-for-workato-overview#h_c14c3e1e79).
        
Deploying changes is not available in this mode.`,
      },
    },
  },
})

export const getConfig = async (options?: InstanceElement): Promise<InstanceElement> => {
  const defaultConfig = await createDefaultInstanceFromType(ElemID.CONFIG_NAME, configType)
  if (options === undefined || !createOptionsTypeGuard<ConfigOptionsType>(optionsElemId)(options)) {
    return defaultConfig
  }
  if (options.value.useCase !== undefined) {
    const clonedConfig = defaultConfig.clone()
    // fallback to enable deploy support
    clonedConfig.value[ENABLE_DEPLOY_SUPPORT_FLAG] = options.value.useCase !== WORKATO_IMPACT_ANALYSIS_OPTION
    return clonedConfig
  }
  return defaultConfig
}

export const configCreator: ConfigCreator = {
  optionsType,
  getConfig,
}