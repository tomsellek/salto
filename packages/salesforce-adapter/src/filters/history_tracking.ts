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
import _ from 'lodash'
import { collections, values as valueUtils } from '@salto-io/lowerdash'
import {
  Change,
  Field, getAllChangeData,
  getChangeData,
  isAdditionOrModificationChange,
  isField,
  isFieldChange,
  isModificationChange,
  isObjectType,
  isObjectTypeChange,
  isRemovalOrModificationChange,
  ModificationChange,
  ObjectType,
  ReferenceExpression,
  toChange,
} from '@salto-io/adapter-api'
import { LocalFilterCreator } from '../filter'
import { apiName, isCustomObject, isFieldOfCustomObject } from '../transformers/transformer'
import { FIELD_ANNOTATIONS, HISTORY_TRACKED_FIELDS, OBJECT_HISTORY_TRACKING_ENABLED } from '../constants'

const { awu } = collections.asynciterable


const isHistoryTrackingEnabled = (type: ObjectType): boolean => (
  (type.annotations[OBJECT_HISTORY_TRACKING_ENABLED] === true)
  || (type.annotations[HISTORY_TRACKED_FIELDS] !== undefined)
)

const centralizeHistoryTrackingAnnotations = (customObject: ObjectType): void => {
  if (!isHistoryTrackingEnabled(customObject)) {
    delete customObject.annotations[OBJECT_HISTORY_TRACKING_ENABLED]
    return
  }

  customObject.annotations[HISTORY_TRACKED_FIELDS] = _(customObject.fields)
    .pickBy(field => (field.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] === true))
    .mapValues(field => (field !== undefined ? new ReferenceExpression(field.elemID) : undefined))
    .value()

  Object.values(customObject.fields).forEach(field => delete field.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY])
  delete customObject.annotations[OBJECT_HISTORY_TRACKING_ENABLED]
}

const createFieldChangeIfApplicable = async (
  field: Field,
  objectTypeChange: ModificationChange<ObjectType>
): Promise<Change<Field> | undefined> => {
  const [typeBefore, typeAfter] = getAllChangeData(objectTypeChange)
  const fieldApiName = await apiName(field)
  const trackedBefore = Object.values(typeBefore.annotations[HISTORY_TRACKED_FIELDS] ?? {}).includes(fieldApiName)
  const trackedAfter = Object.values(typeAfter.annotations[HISTORY_TRACKED_FIELDS] ?? {}).includes(fieldApiName)
  if (trackedBefore === trackedAfter) {
    return undefined
  }

  const fieldBefore = field.clone()
  const fieldAfter = field.clone()
  if (!trackedBefore && trackedAfter) {
    // field was added to the annotations
    fieldBefore.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = false
    fieldAfter.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = true
  } else {
    // field was removed from the annotations
    fieldBefore.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = true
    fieldAfter.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = false
  }

  return toChange({ before: fieldBefore, after: fieldAfter })
}

/**
 * Note: we assume this filter runs *after* custom objects are turned into types (custom_object_to_object_type) but
 * *before* these types are split up into different elements (custom_type_split)
 * */
const filter: LocalFilterCreator = () => ({
  name: 'history_tracking',
  onFetch: async elements => {
    elements
      .filter(isObjectType)
      .filter(isCustomObject)
      .forEach(centralizeHistoryTrackingAnnotations)
  },
  preDeploy: async changes => {
    const trackedFields = (type: ObjectType): string[] => (
      // by the time preDeploy is called references are already resolved, so they won't be ref expressions anymore.
      type.annotations[HISTORY_TRACKED_FIELDS] !== undefined
        ? Object.values(type.annotations[HISTORY_TRACKED_FIELDS]) : []
    )

    const isHistoryTrackedField = async (field: Field): Promise<boolean> => (
      (field.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] === true)
      || trackedFields(field.parent).includes(await apiName(field))
    )

    const changedCustomObjectFields = changes
      .filter(isAdditionOrModificationChange)
      .map(getChangeData)
      .filter(isField)
      .filter(isFieldOfCustomObject)

    const objectTypeChanges = changes
      .filter(isAdditionOrModificationChange)
      .filter(isObjectTypeChange)

    // 1. For all CustomObjects, set the correct 'enableHistory' value
    await awu(objectTypeChanges)
      .map(getChangeData)
      .forEach(objType => {
        objType.annotations[OBJECT_HISTORY_TRACKING_ENABLED] = isHistoryTrackingEnabled(objType)
        _.forOwn(objType.fields, async field => {
          if (await isHistoryTrackedField(field)) {
            field.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = true
          }
        })
      })

    // 2. For all changed fields, make sure they have the expected 'trackHistory' value
    await awu(changedCustomObjectFields)
      .forEach(async field => {
        field.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY] = await isHistoryTrackedField(field)
      })

    // 3. If an object's historyTrackedFields changed:
    //  3.1 for every field that was added/removed in historyTrackedFields:
    //    3.1.1 If there already is a change to the field, it was handled by (1)
    //    3.1.2 Else if the field was added:
    //      3.1.2.1 create a new change where the 'before' part is the field from the object and the 'after' part is
    //              the same field with trackHistory=true
    //    3.1.3 Else if the field was removed:
    //    3.1.3.1 create a new change where the 'before' part is the field from the object with trackHistory=true and
    //            the 'after' part is the field from the object
    // Note: if an object was added we assume we'll get an AdditionChange for every one of its fields, so that case will
    //       be handled in (1)

    const changedFieldNames = changedCustomObjectFields.map(field => field.elemID.getFullName())

    const additionalChanges = await awu(objectTypeChanges)
      .filter(isModificationChange)
      .flatMap(change => awu(Object.values(getChangeData(change).fields))
        .filter(field => !changedFieldNames.includes(field.elemID.getFullName()))
        .map(field => createFieldChangeIfApplicable(field, change))
        .toArray())
      .filter(valueUtils.isDefined)
      .toArray()

    // 4. Remove the 'historyTrackedFields' annotation from all objects
    objectTypeChanges
      .map(getChangeData)
      .forEach(objType => {
        delete objType.annotations[HISTORY_TRACKED_FIELDS]
      })
    changes.push(...additionalChanges)
  },
  onDeploy: async changes => {
    changes
      .filter(isAdditionOrModificationChange)
      .filter(isObjectTypeChange)
      .filter(change => isCustomObject(getChangeData(change)))
      .forEach(change => {
        centralizeHistoryTrackingAnnotations(getChangeData(change))
      })

    changes
      .filter(isAdditionOrModificationChange)
      .filter(isFieldChange)
      .filter(change => isFieldOfCustomObject(getChangeData(change)))
      .forEach(change => {
        delete getChangeData(change).annotations[FIELD_ANNOTATIONS.TRACK_HISTORY]
      })

    changes
      .filter(isRemovalOrModificationChange)
      .filter(isFieldChange)
      .filter(change => isFieldOfCustomObject(getChangeData(change)))
      .forEach(change => {
        delete change.data.before.annotations[FIELD_ANNOTATIONS.TRACK_HISTORY]
      })

    _.remove(changes, change => (
      isModificationChange(change)
      && isObjectTypeChange(change)
      && isCustomObject(getChangeData(change))
      && change.data.before.isEqual(change.data.after)
    ))

    _.remove(changes, change => (
      isModificationChange(change)
      && isFieldChange(change)
      && isFieldOfCustomObject(getChangeData(change))
      && change.data.before.isEqual(change.data.after)
    ))
  },
})

export default filter
