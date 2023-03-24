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
import { LocationCachePool, createLocationCachePool } from '../../../../src/local-workspace/remote_map/location_cache'
import { counters } from '../../../../src/local-workspace/remote_map/counters'

describe('remote map location cache pool', () => {
  let pool: LocationCachePool
  const LOCATION1 = 'SomeLocation'
  const LOCATION2 = 'SomeOtherLocation'

  beforeEach(() => {
    pool = createLocationCachePool()
  })

  afterEach(() => {
    [LOCATION1, LOCATION2].forEach(loc => counters.deleteLocation(loc))
  })

  it('should create a location cache for the right location', () => {
    const cache = pool.get(LOCATION1, 5000)
    expect(cache.location).toEqual(LOCATION1)
    expect(counters.locationCounters(LOCATION1).LocationCacheCreated.value()).toEqual(1)
    expect(counters.locationCounters(LOCATION1).LocationCacheReuse.value()).toEqual(0)
    pool.release(cache)
  })

  it('should reuse caches where possible', () => {
    const caches = _.times(10, () => pool.get(LOCATION1, 5000))
    expect(counters.locationCounters(LOCATION1).LocationCacheCreated.value()).toEqual(1)
    expect(counters.locationCounters(LOCATION1).LocationCacheReuse.value()).toEqual(caches.length - 1)
    caches.forEach(cache => pool.release(cache))
  })

  it('should not reuse caches of a different location', () => {
    const cache = pool.get(LOCATION1, 5000)
    const anotherCache = pool.get(LOCATION2, 5000)
    expect(cache.location).toEqual(LOCATION1)
    expect(anotherCache.location).toEqual(LOCATION2)
    expect(counters.locationCounters(LOCATION1).LocationCacheCreated.value()).toEqual(1)
    expect(counters.locationCounters(LOCATION2).LocationCacheCreated.value()).toEqual(1)
    expect(counters.locationCounters(LOCATION1).LocationCacheReuse.value()).toEqual(0)
    pool.release(cache)
    pool.release(anotherCache)
  })

  it('should destroy cache when the last reference to it is returned', () => {
    const cache = pool.get(LOCATION1, 5000)
    pool.release(cache)
    const anotherCache = pool.get(LOCATION1, 5000)
    expect(counters.locationCounters(LOCATION1).LocationCacheCreated.value()).toEqual(2)
    expect(counters.locationCounters(LOCATION1).LocationCacheReuse.value()).toEqual(0)
    pool.release(anotherCache)
  })
})