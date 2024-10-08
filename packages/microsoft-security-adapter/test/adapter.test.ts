/*
 * Copyright 2024 Salto Labs Ltd.
 * Licensed under the Salto Terms of Use (the "License");
 * You may not use this file except in compliance with the License.  You may obtain a copy of the License at https://www.salto.io/terms-of-use
 *
 * CERTAIN THIRD PARTY SOFTWARE MAY BE CONTAINED IN PORTIONS OF THE SOFTWARE. See NOTICE FILE AT https://github.com/salto-io/salto/blob/main/NOTICES
 */
import _ from 'lodash'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Element, InstanceElement, isInstanceElement, ObjectType, ReferenceExpression } from '@salto-io/adapter-api'
import { definitions } from '@salto-io/adapter-components'
import { buildElementsSourceFromElements } from '@salto-io/adapter-utils'
import { adapter } from '../src/adapter_creator'
import { credentialsType } from '../src/client/oauth'
import { DEFAULT_CONFIG } from '../src/config'
import fetchMockReplies from './fetch_mock_replies.json'

type MockReply = {
  url: string
  method: definitions.HTTPMethod
  params?: Record<string, string>
  response: unknown
}

describe('Microsoft Security adapter', () => {
  jest.setTimeout(10 * 1000)
  let mockAxiosAdapter: MockAdapter

  beforeEach(async () => {
    mockAxiosAdapter = new MockAdapter(axios, { delayResponse: 1, onNoMatch: 'throwException' })
    mockAxiosAdapter.onGet('/v1.0/me').reply(200, { app: { id_code: '123' } })
    mockAxiosAdapter.onPost('https://login.microsoftonline.com/testTenantId/oauth2/v2.0/token').reply(200, {
      access_token: 'testAccessToken',
    })
    ;([...fetchMockReplies] as MockReply[]).forEach(({ url, params, response }) => {
      const mock = mockAxiosAdapter.onGet.bind(mockAxiosAdapter)
      const handler = mock(url, !_.isEmpty(params) ? { params } : undefined)
      handler.replyOnce(200, response)
    })
  })

  afterEach(() => {
    mockAxiosAdapter.restore()
    jest.clearAllMocks()
  })

  describe('fetch', () => {
    describe('full', () => {
      let elements: Element[]
      beforeEach(async () => {
        ;({ elements } = await adapter
          .operations({
            credentials: new InstanceElement('config', credentialsType, {
              tenantId: 'testTenantId',
              clientId: 'testClientId',
              clientSecret: 'testClient',
              refreshToken: 'testRefreshToken',
            }),
            config: new InstanceElement('config', adapter.configType as ObjectType, DEFAULT_CONFIG),
            elementsSource: buildElementsSourceFromElements([]),
          })
          .fetch({ progressReporter: { reportProgress: () => null } }))
      })

      it('should generate the right elements on fetch', async () => {
        expect([...new Set(elements.filter(isInstanceElement).map(e => e.elemID.typeName))].sort()).toEqual([
          'EntraAdministrativeUnit',
          'EntraAppRole',
          'EntraApplication',
          'EntraAuthenticationMethodPolicy',
          'EntraAuthenticationMethodPolicy__authenticationMethodConfigurations',
          'EntraAuthenticationStrengthPolicy',
          'EntraConditionalAccessPolicy',
          'EntraConditionalAccessPolicyNamedLocation',
          'EntraCrossTenantAccessPolicy',
          'EntraCustomSecurityAttributeDefinition',
          'EntraCustomSecurityAttributeDefinition__allowedValues',
          'EntraCustomSecurityAttributeSet',
          'EntraDirectoryRoleTemplate',
          'EntraDomain',
          'EntraGroup',
          'EntraGroupLifeCyclePolicy',
          'EntraGroup__appRoleAssignments',
          'EntraOauth2PermissionGrant',
          'EntraPermissionGrantPolicy',
          'EntraRoleDefinition',
          'EntraServicePrincipal',
          'IntuneApplication',
          'IntuneApplicationConfigurationManagedApp',
          'IntuneApplicationConfigurationManagedDevice',
          'IntuneDeviceCompliance',
          'IntuneDeviceConfiguration',
          'IntuneDeviceConfigurationSettingCatalog',
        ])
        // TODO: Validate Entra sub-types and structure of the elements
      })

      describe('specific instances', () => {
        describe('Intune', () => {
          describe('applications', () => {
            let intuneApplications: InstanceElement[]
            beforeEach(async () => {
              intuneApplications = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneApplication')
            })

            it('should create the correct instances for Intune applications', async () => {
              expect(intuneApplications).toHaveLength(6)

              const intuneApplicationNames = intuneApplications.map(e => e.elemID.name)
              expect(intuneApplicationNames).toEqual(
                expect.arrayContaining([
                  'iosStoreApp_test',
                  'androidStoreApp_com_test@uv',
                  'androidManagedStoreApp_com_test@uv',
                  'managedIOSStoreApp_test',
                  'managedAndroidStoreApp_com_test2@uv',
                  'managedAndroidStoreApp_com_test@uv',
                ]),
              )
            })

            it('should create the Intune application instances with the correct path', async () => {
              const intuneApplicationParts = intuneApplications.map(e => e.path)
              expect(intuneApplicationParts).toEqual(
                expect.arrayContaining([
                  ['microsoft_security', 'Records', 'IntuneApplication', 'iosStoreApp', 'test'],
                  ['microsoft_security', 'Records', 'IntuneApplication', 'androidStoreApp', 'com_test'],
                  ['microsoft_security', 'Records', 'IntuneApplication', 'androidManagedStoreApp', 'com_test'],
                  ['microsoft_security', 'Records', 'IntuneApplication', 'managedIOSStoreApp', 'test'],
                  ['microsoft_security', 'Records', 'IntuneApplication', 'managedAndroidStoreApp', 'com_test2'],
                  ['microsoft_security', 'Records', 'IntuneApplication', 'managedAndroidStoreApp', 'com_test'],
                ]),
              )
            })
          })

          describe('application configurations - managed apps', () => {
            let intuneApplicationConfigurations: InstanceElement[]
            beforeEach(async () => {
              intuneApplicationConfigurations = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneApplicationConfigurationManagedApp')
            })

            it('should create the correct instances for Intune application configurations', async () => {
              expect(intuneApplicationConfigurations).toHaveLength(1)

              const intuneApplicationConfigurationNames = intuneApplicationConfigurations.map(e => e.elemID.name)
              expect(intuneApplicationConfigurationNames).toEqual(expect.arrayContaining(['test_configuration@s']))
            })

            it('should create the Intune application configuration instances with the correct path', async () => {
              const intuneApplicationConfigurationParts = intuneApplicationConfigurations.map(e => e.path)
              expect(intuneApplicationConfigurationParts).toEqual(
                expect.arrayContaining([
                  ['microsoft_security', 'Records', 'IntuneApplicationConfigurationManagedApp', 'test_configuration'],
                ]),
              )
            })

            it('should reference the correct target application', async () => {
              const intuneApplicationConfiguration = intuneApplicationConfigurations[0]
              const targetApps = intuneApplicationConfiguration.value.apps
              expect(targetApps).toHaveLength(1)
              expect(targetApps[0]).toEqual({
                mobileAppIdentifier: {
                  '_odata_type@mv': '#microsoft.graph.androidMobileAppIdentifier',
                  packageId: expect.any(ReferenceExpression),
                },
              })
              expect(targetApps[0].mobileAppIdentifier.packageId.elemID.getFullName()).toEqual(
                'microsoft_security.IntuneApplication.instance.managedAndroidStoreApp_com_test2@uv',
              )
            })
          })

          describe('application configurations - managed devices', () => {
            let intuneApplicationConfigurations: InstanceElement[]
            beforeEach(async () => {
              intuneApplicationConfigurations = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneApplicationConfigurationManagedDevice')
            })

            it('should create the correct instances for Intune application configurations', async () => {
              expect(intuneApplicationConfigurations).toHaveLength(2)

              const intuneApplicationConfigurationNames = intuneApplicationConfigurations.map(e => e.elemID.name)
              expect(intuneApplicationConfigurationNames).toEqual(
                expect.arrayContaining(['test_android@s', 'test_ios@s']),
              )
            })

            it('should create the Intune application configuration instances with the correct path', async () => {
              const intuneApplicationConfigurationParts = intuneApplicationConfigurations.map(e => e.path)
              expect(intuneApplicationConfigurationParts).toEqual(
                expect.arrayContaining([
                  ['microsoft_security', 'Records', 'IntuneApplicationConfigurationManagedDevice', 'test_android'],
                  ['microsoft_security', 'Records', 'IntuneApplicationConfigurationManagedDevice', 'test_ios'],
                ]),
              )
            })

            it('should reference the correct target mobile apps', async () => {
              const iosIdx = intuneApplicationConfigurations.findIndex(e => e.elemID.name === 'test_ios@s')
              const intuneApplicationConfigurationIos = intuneApplicationConfigurations[iosIdx]
              const targetMobileAppsIos = intuneApplicationConfigurationIos.value.targetedMobileApps
              expect(targetMobileAppsIos).toHaveLength(1)
              expect(targetMobileAppsIos[0]).toBeInstanceOf(ReferenceExpression)
              expect(targetMobileAppsIos[0].elemID.getFullName()).toEqual(
                'microsoft_security.IntuneApplication.instance.managedIOSStoreApp_test',
              )

              const androidIdx = intuneApplicationConfigurations.findIndex(e => e.elemID.name === 'test_android@s')
              const intuneApplicationConfigurationAndroid = intuneApplicationConfigurations[androidIdx]
              const targetMobileAppsAndroid = intuneApplicationConfigurationAndroid.value.targetedMobileApps
              expect(targetMobileAppsAndroid).toHaveLength(1)
              expect(targetMobileAppsAndroid[0]).toBeInstanceOf(ReferenceExpression)
              expect(targetMobileAppsAndroid[0].elemID.getFullName()).toEqual(
                'microsoft_security.IntuneApplication.instance.managedAndroidStoreApp_com_test@uv',
              )
            })

            it('should parse the payloadJson field correctly', async () => {
              const androidIdx = intuneApplicationConfigurations.findIndex(e => e.elemID.name === 'test_android@s')
              const intuneApplicationConfigurationAndroid = intuneApplicationConfigurations[androidIdx]
              expect(intuneApplicationConfigurationAndroid.value.payloadJson).toEqual({
                kind: 'androidenterprise#managedConfiguration',
                productId: 'app:com.microsoft.launcher.enterprise',
                managedProperty: [
                  {
                    key: 'show_volume_setting',
                    valueBool: false,
                  },
                  {
                    key: 'screen_saver_image',
                    valueString: 'hehe',
                  },
                ],
              })
            })

            it('should parse the encodedSettingXml field correctly', async () => {
              const iosIdx = intuneApplicationConfigurations.findIndex(e => e.elemID.name === 'test_ios@s')
              const intuneApplicationConfigurationIos = intuneApplicationConfigurations[iosIdx]
              expect(intuneApplicationConfigurationIos.value.encodedSettingXml).toEqual({
                dict: {
                  key: 'hi',
                  string: 'bye',
                },
              })
            })
          })

          describe('device configurations', () => {
            let intuneDeviceConfigurations: InstanceElement[]
            beforeEach(async () => {
              intuneDeviceConfigurations = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneDeviceConfiguration')
            })

            it('should create the correct instances for Intune device configurations', async () => {
              expect(intuneDeviceConfigurations).toHaveLength(4)

              const intuneDeviceConfigurationNames = intuneDeviceConfigurations.map(e => e.elemID.name)
              expect(intuneDeviceConfigurationNames).toEqual(
                expect.arrayContaining([
                  'test_ios_email_configuration@s',
                  'test_wifi_configuration@s',
                  'test_windows_10_email_configuration@s',
                  'test_windows_health_monitoring@s',
                ]),
              )
            })
          })

          describe('device configurations - setting catalog', () => {
            let intuneDeviceConfigurationSettingCatalogs: InstanceElement[]
            beforeEach(async () => {
              intuneDeviceConfigurationSettingCatalogs = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneDeviceConfigurationSettingCatalog')
            })

            it('should create the correct instances for Intune device configuration setting catalogs', async () => {
              expect(intuneDeviceConfigurationSettingCatalogs).toHaveLength(1)

              const intuneDeviceConfigurationSettingCatalogNames = intuneDeviceConfigurationSettingCatalogs.map(
                e => e.elemID.name,
              )
              expect(intuneDeviceConfigurationSettingCatalogNames).toEqual(
                expect.arrayContaining(['test_setting_catalog_policy@s']),
              )
            })

            it('should include the settings field with the correct values', async () => {
              const intuneDeviceConfigurationSettingCatalog = intuneDeviceConfigurationSettingCatalogs[0]
              expect(intuneDeviceConfigurationSettingCatalog.value.settings).toHaveLength(10)
              expect(Object.keys(intuneDeviceConfigurationSettingCatalog.value.settings[0])).toEqual([
                'settingInstance',
              ])
            })
          })

          describe('device compliances', () => {
            let intuneDeviceCompliances: InstanceElement[]
            beforeEach(async () => {
              intuneDeviceCompliances = elements
                .filter(isInstanceElement)
                .filter(e => e.elemID.typeName === 'IntuneDeviceCompliance')
            })

            it('should create the correct instances for Intune device compliances', async () => {
              expect(intuneDeviceCompliances).toHaveLength(1)

              const intuneDeviceComplianceNames = intuneDeviceCompliances.map(e => e.elemID.name)
              expect(intuneDeviceComplianceNames).toEqual(expect.arrayContaining(['test_IOS@s']))
            })

            it('should add a reference to the correct intune application', async () => {
              const intuneDeviceCompliance = intuneDeviceCompliances[0]
              const groupRef = intuneDeviceCompliance.value.restrictedApps[0]?.appId
              expect(groupRef).toBeInstanceOf(ReferenceExpression)
              expect(groupRef.elemID.getFullName()).toEqual(
                'microsoft_security.IntuneApplication.instance.managedIOSStoreApp_test',
              )
            })

            it('should include scheduledActionsForRule field with the correct values', async () => {
              const intuneDeviceCompliance = intuneDeviceCompliances[0]

              const { scheduledActionsForRule } = intuneDeviceCompliance.value
              expect(scheduledActionsForRule).toHaveLength(1)
              expect(Object.keys(scheduledActionsForRule[0])).toEqual(['scheduledActionConfigurations'])

              const { scheduledActionConfigurations } = scheduledActionsForRule[0]
              expect(scheduledActionConfigurations).toHaveLength(1)
              expect(Object.keys(scheduledActionConfigurations[0])).toEqual([
                'gracePeriodHours',
                'actionType',
                'notificationTemplateId',
              ])
            })
          })
        })
      })
    })
  })
  // TODO: implement deploy UTs
})
