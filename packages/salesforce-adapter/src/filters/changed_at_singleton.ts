/*
*                      Copyright 2023 Salto Labs Ltd.
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
  CORE_ANNOTATIONS,
  Element,
  Values,
} from '@salto-io/adapter-api'
import _ from 'lodash'
import { LocalFilterCreator } from '../filter'
import { createChangedAtInformation } from './author_information/changed_at_info'
import {
  apiNameSync,
  isCustomObjectSync,
  isMetadataInstanceElementSync,
  metadataTypeSync,
} from './utils'

const changedAtByType = (
  metadataInstancesByType: Record<string, Element[]>
): Record<string, Record<string, string>> => {
  const instanceValues: Values = {}
  Object.entries(metadataInstancesByType).forEach(([metadataType, elements]) => {
    instanceValues[metadataType] = {}
    elements.forEach(element => {
      instanceValues[metadataType][apiNameSync(element) ?? ''] = element.annotations[CORE_ANNOTATIONS.CHANGED_AT]
    })
  })
  return instanceValues
}

const filterCreator: LocalFilterCreator = ({ config }) => ({
  name: 'changedAtSingletonFilter',
  onFetch: async (elements: Element[]) => {
    const elementsByType = _.groupBy(
      elements
        .filter(element => isMetadataInstanceElementSync(element) || isCustomObjectSync(element))
        .filter(element => element.annotations[CORE_ANNOTATIONS.CHANGED_AT]),
      metadataTypeSync
    )
    const changedAtInstance = await createChangedAtInformation(config.elementsSource)
    elements.push(changedAtInstance.backingElement())
    // None of the Elements were annotated with changedAt
    if (Object.values(elementsByType).flat().length === 0) {
      return
    }
    changedAtInstance.updateTypesChangedAt(changedAtByType(elementsByType))
  },
})

export default filterCreator
