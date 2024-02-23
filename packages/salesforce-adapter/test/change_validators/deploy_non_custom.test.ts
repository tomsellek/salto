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
  ChangeError,
  InstanceElement,
  toChange,
  ObjectType,
  ElemID,
} from '@salto-io/adapter-api'
import deployNonDeployableTypes from '../../src/change_validators/deploy_non_custom'
import { createMetadataObjectType } from '../../src/transformers/transformer'
import {
  API_NAME,
  CUSTOM_OBJECT,
  METADATA_TYPE,
  SALESFORCE,
} from '../../src/constants'
import { mockTypes } from '../mock_elements'

describe('deployNonDeployableTypes', () => {
  let validatorResult: ReadonlyArray<ChangeError>
  describe('When deploying custom object types', () => {
    beforeEach(async () => {
      validatorResult = await deployNonDeployableTypes([
        toChange({ after: mockTypes.Account }),
      ])
    })
    it('should not generate errors', () => {
      expect(validatorResult).toBeEmpty()
    })
  })
  describe('When deploying instances', () => {
    beforeEach(async () => {
      validatorResult = await deployNonDeployableTypes([
        toChange({
          after: new InstanceElement('SomeAccount', mockTypes.Account),
        }),
      ])
    })
    it('should not generate errors', () => {
      expect(validatorResult).toBeEmpty()
    })
  })
  describe('When deploying metadata types', () => {
    const metadataType = createMetadataObjectType({
      annotations: {
        [METADATA_TYPE]: 'SomeMetadataType',
      },
    })
    beforeEach(async () => {
      validatorResult = await deployNonDeployableTypes([
        toChange({ after: metadataType }),
      ])
    })
    it('should generate errors', () => {
      expect(validatorResult).toSatisfyAll((error) =>
        error.elemID.isEqual(metadataType.elemID),
      )
    })
  })
  describe('E2E test', () => {
    const objectType = new ObjectType({
      elemID: new ElemID(SALESFORCE, 'NewObjectName'),
      annotations: {
        [METADATA_TYPE]: CUSTOM_OBJECT,
        [API_NAME]: 'NewObjectName',
      },
    })
    beforeEach(async () => {
      validatorResult = await deployNonDeployableTypes([
        toChange({ after: objectType }),
      ])
    })
    it('should not generate errors', () => {
      expect(validatorResult).toBeEmpty()
    })
  })
})
