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

import _, { Dictionary } from 'lodash'
import { collections, promises } from '@salto-io/lowerdash'
import { logger } from '@salto-io/logging'
import {
  Element,
  ElemID,
  InstanceElement,
  isInstanceElement,
  ReferenceInfo,
  Values,
} from '@salto-io/adapter-api'
import { WeakReferencesHandler } from '../types'
import {
  APEX_CLASS_METADATA_TYPE,
  APEX_PAGE_METADATA_TYPE,
  API_NAME_SEPARATOR,
  CUSTOM_APPLICATION_METADATA_TYPE,
  SALESFORCE,
  FLOW_METADATA_TYPE,
  LAYOUT_TYPE_ID_METADATA_TYPE,
  PROFILE_METADATA_TYPE,
  RECORD_TYPE_METADATA_TYPE,
  PERMISSION_SET_METADATA_TYPE,
} from '../constants'
import { Types } from '../transformers/transformer'

const { makeArray } = collections.array
const { awu } = collections.asynciterable
const { pickAsync } = promises.object
const log = logger(module)

enum section {
  APEX_CLASS = 'classAccesses',
  APEX_PAGE = 'pageAccesses',
  APP_VISIBILITY = 'applicationVisibilities',
  FIELD_PERMISSIONS = 'fieldPermissions',
  FLOW = 'flowAccesses',
  LAYOUTS = 'layoutAssignments',
  OBJECT = 'objectPermissions',
  RECORD_TYPE = 'recordTypeVisibilities',
}

const FIELD_NO_ACCESS = 'NoAccess'

const getMetadataElementName = (fullName: string): string =>
  Types.getElemId(fullName.replace(API_NAME_SEPARATOR, '_'), true).name

type ReferenceInSection = {
  sourceField?: string
  target: ElemID
}

type RefTargetsGetter = (
  sectionEntry: Values,
  sectionEntryKey: string,
) => ReferenceInSection[]

type ReferenceFromSectionParams = {
  filter?: (sectionEntry: Values) => boolean
  targetsGetter: RefTargetsGetter
}

const mapSectionEntries = <T>(
  profileOrPermissionSet: InstanceElement,
  sectionName: section,
  { filter = () => true, targetsGetter }: ReferenceFromSectionParams,
  f: (sectionEntryKey: string, target: ElemID, sourceField?: string) => T,
): T[] => {
  const sectionValue = profileOrPermissionSet.value[sectionName]
  if (!_.isPlainObject(sectionValue)) {
    if (sectionValue !== undefined) {
      log.warn(
        'Section %s of %s is not an object, skipping.',
        sectionName,
        profileOrPermissionSet.elemID,
      )
    }
    return []
  }
  return Object.entries(sectionValue as Values)
    .filter(([, sectionEntry]) => filter(sectionEntry))
    .flatMap(([sectionEntryKey, sectionEntry]) => {
      const targets = targetsGetter(sectionEntry, sectionEntryKey)
      return targets.map(({ target, sourceField }) =>
        f(sectionEntryKey, target, sourceField),
      )
    })
}

const isEnabled = (sectionEntry: Values): boolean =>
  sectionEntry.enabled === true

const isAnyAccessEnabledForObject = (
  objectAccessSectionEntry: Values,
): boolean =>
  [
    objectAccessSectionEntry.allowCreate,
    objectAccessSectionEntry.allowDelete,
    objectAccessSectionEntry.allowEdit,
    objectAccessSectionEntry.allowRead,
    objectAccessSectionEntry.modifyAllRecords,
    objectAccessSectionEntry.viewAllRecords,
  ].some((permission) => permission === true)

const isAnyAccessEnabledForField = (
  fieldPermissionsSectionEntry: Values,
): boolean =>
  Object.values(fieldPermissionsSectionEntry).some(
    (val) => val !== FIELD_NO_ACCESS,
  )

const referenceToInstance =
  (fieldName: string, targetType: string): RefTargetsGetter =>
  (sectionEntry) => {
    if (!_.isString(sectionEntry[fieldName])) {
      return []
    }
    const elemIdName = getMetadataElementName(sectionEntry[fieldName])
    return [
      {
        target: Types.getElemId(targetType, false).createNestedID(
          'instance',
          elemIdName,
        ),
      },
    ]
  }

const referenceToType =
  (fieldName: string): RefTargetsGetter =>
  (sectionEntry) => {
    if (!_.isString(sectionEntry[fieldName])) {
      return []
    }
    return [
      {
        target: Types.getElemId(sectionEntry[fieldName], true),
      },
    ]
  }

const referencesToFields: RefTargetsGetter = (
  sectionEntry,
  sectionEntryKey,
) => {
  const typeElemId = Types.getElemId(sectionEntryKey, true)
  return Object.entries(sectionEntry)
    .filter(([, fieldAccess]) => fieldAccess !== FIELD_NO_ACCESS)
    .map(([fieldName]) => ({
      target: typeElemId.createNestedID(
        'field',
        getMetadataElementName(fieldName),
      ),
      sourceField: fieldName,
    }))
}

const layoutReferences: RefTargetsGetter = (sectionEntry) => {
  if (!_.isString(sectionEntry[0]?.layout)) {
    return []
  }
  const layoutElemIdName = getMetadataElementName(sectionEntry[0].layout)
  const layoutRef = {
    target: new ElemID(
      SALESFORCE,
      LAYOUT_TYPE_ID_METADATA_TYPE,
      'instance',
      layoutElemIdName,
    ),
  }

  const recordTypeRefs = sectionEntry
    .filter((layoutAssignment: Values) =>
      _.isString(layoutAssignment.recordType),
    )
    .map((layoutAssignment: Values) => ({
      target: new ElemID(
        SALESFORCE,
        RECORD_TYPE_METADATA_TYPE,
        'instance',
        getMetadataElementName(layoutAssignment.recordType),
      ),
    }))

  return [layoutRef].concat(recordTypeRefs)
}

const recordTypeReferences: RefTargetsGetter = (sectionEntry) =>
  Object.entries(sectionEntry)
    .filter(
      ([, recordTypeVisibility]) =>
        recordTypeVisibility.default === true ||
        recordTypeVisibility.visible === true,
    )
    .filter(([, recordTypeVisibility]) =>
      _.isString(recordTypeVisibility.recordType),
    )
    .map(([recordTypeVisibilityKey, recordTypeVisibility]) => ({
      target: new ElemID(
        SALESFORCE,
        RECORD_TYPE_METADATA_TYPE,
        'instance',
        getMetadataElementName(recordTypeVisibility.recordType),
      ),
      sourceField: recordTypeVisibilityKey,
    }))

const sectionsReferenceParams: Record<section, ReferenceFromSectionParams> = {
  [section.APP_VISIBILITY]: {
    filter: (appVisibilityEntry) =>
      appVisibilityEntry.default || appVisibilityEntry.visible,
    targetsGetter: referenceToInstance(
      'application',
      CUSTOM_APPLICATION_METADATA_TYPE,
    ),
  },
  [section.APEX_CLASS]: {
    filter: isEnabled,
    targetsGetter: referenceToInstance('apexClass', APEX_CLASS_METADATA_TYPE),
  },
  [section.FLOW]: {
    filter: isEnabled,
    targetsGetter: referenceToInstance('flow', FLOW_METADATA_TYPE),
  },
  [section.APEX_PAGE]: {
    filter: isEnabled,
    targetsGetter: referenceToInstance('apexPage', APEX_PAGE_METADATA_TYPE),
  },
  [section.OBJECT]: {
    filter: isAnyAccessEnabledForObject,
    targetsGetter: referenceToType('object'),
  },
  [section.FIELD_PERMISSIONS]: {
    filter: isAnyAccessEnabledForField,
    targetsGetter: referencesToFields,
  },
  [section.LAYOUTS]: {
    targetsGetter: layoutReferences,
  },
  [section.RECORD_TYPE]: {
    targetsGetter: recordTypeReferences,
  },
}

export const mapProfileOrPermissionSetSections = <T>(
  profileOrPermissionSet: InstanceElement,
  f: (
    sectionName: string,
    sectionEntryKey: string,
    target: ElemID,
    sourceField?: string,
  ) => T,
): T[] =>
  Object.entries(sectionsReferenceParams).flatMap(([sectionName, params]) =>
    mapSectionEntries(
      profileOrPermissionSet,
      sectionName as section,
      params,
      _.curry(f)(sectionName),
    ),
  )

const referencesFromProfileOrPermissionSet = (
  profileOrPermissionSet: InstanceElement,
): ReferenceInfo[] =>
  mapProfileOrPermissionSetSections(
    profileOrPermissionSet,
    (sectionName, sectionEntryKey, target, sourceField) => ({
      source: profileOrPermissionSet.elemID.createNestedID(
        sectionName,
        sectionEntryKey,
        ...makeArray(sourceField),
      ),
      target,
      type: 'weak',
    }),
  )

// At this point the TypeRefs of instance elements are not resolved yet, so isInstanceOfTypeSync() won't work - we
// have to figure out the type name the hard way.
const filterProfilesAndPermissionSets = (
  elements: Element[],
): InstanceElement[] =>
  elements
    .filter(isInstanceElement)
    .filter(
      (instance) =>
        instance.elemID.typeName === PROFILE_METADATA_TYPE ||
        instance.elemID.typeName === PERMISSION_SET_METADATA_TYPE,
    )

const findWeakReferences: WeakReferencesHandler['findWeakReferences'] = async (
  elements: Element[],
): Promise<ReferenceInfo[]> => {
  const profilesAndPermissionSets = filterProfilesAndPermissionSets(elements)
  const refs = log.timeDebug(
    () =>
      profilesAndPermissionSets.flatMap(referencesFromProfileOrPermissionSet),
    `Generating references from ${profilesAndPermissionSets.length} profiles/permission sets.`,
  )
  log.debug(
    'Generated %d references for %d elements.',
    refs.length,
    elements.length,
  )
  return refs
}

const profileOrPermissionSetEntriesTargets = (
  profileOrPermissionSet: InstanceElement,
): Dictionary<ElemID> =>
  _(
    mapProfileOrPermissionSetSections(
      profileOrPermissionSet,
      (sectionName, sectionEntryKey, target, sourceField): [string, ElemID] => [
        [sectionName, sectionEntryKey, ...makeArray(sourceField)].join('.'),
        target,
      ],
    ),
  )
    .fromPairs()
    .value()

const removeWeakReferences: WeakReferencesHandler['removeWeakReferences'] =
  ({ elementsSource }) =>
  async (elements) => {
    const profilesAndPermissionSets = filterProfilesAndPermissionSets(elements)
    const entriesTargets: Dictionary<ElemID> = _.merge(
      {},
      ...profilesAndPermissionSets.map(profileOrPermissionSetEntriesTargets),
    )
    const elementNames = new Set(
      await awu(await elementsSource.list())
        .map((elemID) => elemID.getFullName())
        .toArray(),
    )
    const brokenReferenceFields = Object.keys(
      await pickAsync(
        entriesTargets,
        async (target) => !elementNames.has(target.getFullName()),
      ),
    )
    const profilesWithBrokenReferences = profilesAndPermissionSets.filter(
      (profileOrPermissionSet) =>
        brokenReferenceFields.some((field) =>
          _(profileOrPermissionSet.value).has(field),
        ),
    )
    const fixedElements = profilesWithBrokenReferences.map(
      (profileOrPermissionSet) => {
        const fixed = profileOrPermissionSet.clone()
        fixed.value = _.omit(fixed.value, brokenReferenceFields)
        return fixed
      },
    )
    const errors = profilesWithBrokenReferences.map(
      (profileOrPermissionSet) => {
        const profileBrokenReferenceFields = brokenReferenceFields
          .filter((field) => _(profileOrPermissionSet.value).has(field))
          .map((field) => entriesTargets[field].getFullName())
          .sort()

        log.trace(
          `Removing ${profileBrokenReferenceFields.length} broken references from ${profileOrPermissionSet.elemID.getFullName()}: ${profileBrokenReferenceFields.join(
            ', ',
          )}`,
        )

        return {
          elemID: profileOrPermissionSet.elemID,
          severity: 'Info' as const,
          message:
            'Dropping profile/permission set fields which reference missing types',
          detailedMessage: `The profile/permission set has ${profileBrokenReferenceFields.length} fields which reference types which are not available in the workspace.`,
        }
      },
    )

    return { fixedElements, errors }
  }

export const profilesHandler: WeakReferencesHandler = {
  findWeakReferences,
  removeWeakReferences,
}
