import { describe, expect, it } from 'vitest'

import { DISCORD_KIND_IDS, defaultDiscordConfig, normalizeDiscordConfig } from './discord-config'

describe('discord config', () => {
  it('pings peter180ty and navalxz for critical alerts by default, nobody for low ones', () => {
    const config = defaultDiscordConfig()
    expect(config.people.map((p) => p.label)).toEqual(['peter180ty', 'navalxz'])
    expect(config.kinds.ip_locked).toEqual({ send: true, ping: ['peter180ty', 'navalxz'] })
    expect(config.kinds.new_ip).toEqual({ send: false, ping: [] })
  })

  it('keeps the critical role switched off until the owner sets it up', () => {
    expect(defaultDiscordConfig().criticalRole).toEqual({ enabled: false, roleId: '' })
    expect(normalizeDiscordConfig({ criticalRole: { enabled: true, roleId: '123456789012345678' } }).criticalRole).toEqual({
      enabled: true,
      roleId: '123456789012345678',
    })
  })

  it('fills in new alert kinds and drops pings of removed people', () => {
    const config = normalizeDiscordConfig({
      enabled: false,
      people: [{ id: 'a', label: 'A', discordId: '', enabled: true }],
      kinds: { ip_locked: { send: true, ping: ['a', 'gone'] } },
    })
    expect(config.enabled).toBe(false)
    expect(config.kinds.ip_locked!.ping).toEqual(['a'])
    expect(Object.keys(config.kinds).sort()).toEqual([...DISCORD_KIND_IDS].sort())
  })
})
