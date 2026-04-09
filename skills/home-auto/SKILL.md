---
name: home-auto
description: "Home Assistant integration: query sensor history, detect anomalies, control devices, and send notifications. Uses HA MCP tools for live state and device control, TimescaleDB for 256M+ historical sensor readings, and Telegram for proactive alerts."
metadata:
  {
    "openclaw":
      {
        "emoji": "🏠",
      },
  }
---

# Home Automation Skill

Control Home Assistant devices, query historical sensor data from TimescaleDB, detect anomalies, and send Telegram notifications.

## When to Use

**USE this skill when:**

- Checking current device states ("is the living room light on?", "what's the temperature?")
- Querying historical sensor data ("what was the basement humidity last week?")
- Detecting anomalies in sensor readings ("is the kitchen temperature normal?")
- Controlling devices ("turn on the office light", "set bedroom to 21 degrees")
- Investigating energy usage patterns
- Setting up or suggesting automations
- Sending alerts about home events

**DON'T use this skill when:**

- Managing K8s cluster infrastructure (use cluster-ops)
- Working with code or git repositories
- General conversation not related to the home

## Available Tools

### Home Assistant MCP Tools (live state + control)

- `home-assistant__GetLiveContext` — Overview of all device states, areas, and attributes. **Use this first** to understand what's available
- `home-assistant__HassTurnOn` / `home-assistant__HassTurnOff` — Turn devices on/off
- `home-assistant__HassLightSet` — Set light brightness, color, or temperature
- `home-assistant__HassClimateSetTemperature` — Set thermostat target temperature
- `home-assistant__HassFanSetSpeed` — Set fan speed by percentage
- `home-assistant__HassSetPosition` — Set cover/blind position
- `home-assistant__HassMediaPause` / `HassMediaUnpause` / `HassMediaNext` — Media player control
- `home-assistant__HassSetVolume` — Set media player volume
- `home-assistant__HassHumidifierSetpoint` — Set humidity target
- `home-assistant__HassBroadcast` — Broadcast a message through the home

### TimescaleDB Tools (historical data + analysis)

- `ha_history` — Query historical sensor readings over a time range. Params: `entity_id` (required), `hours` (default 24)
- `ha_baseline` — Compute mean, stddev, min, max for a numeric sensor. Params: `entity_id` (required), `window_days` (default 7)
- `ha_anomalies` — Check if a current value is anomalous against historical baseline. Params: `entity_id`, `current_value` (required), `threshold` (z-score, default 2.0)
- `ha_notify` — Send a proactive Telegram notification. Rate-limited to 1 per 30 seconds

## Safe Autonomous Actions (no confirmation needed)

You MAY execute these directly without asking the user:

- **Lights**: turn on/off, set brightness, color, temperature
- **Scenes**: activate any scene
- **Heating/Climate**: set target temperature (setpoint changes only)
- **Fans**: turn on/off, set speed
- **Dehumidifiers**: turn on/off, set target humidity
- **Presence sensors**: override presence state
- **Media players**: play, pause, skip, volume

## Actions Requiring Human Confirmation

**ALWAYS** ask the user before executing these. Explain what you intend to do and wait for explicit approval:

- **Locks**: lock/unlock any door
- **Alarms/Sirens**: arm/disarm, trigger
- **Garage doors**: open/close
- **HVAC shutoff**: turning off heating/cooling entirely (setpoint changes are fine)
- **Covers/Blinds**: open/close (these may have security implications)
- **Any automation that affects security**

Format confirmation requests clearly:

> I'd like to unlock the front door. Should I proceed? (Reply yes/no)

## Common Patterns

### Check current home state

```
1. Call GetLiveContext to see all devices
2. Summarize the relevant areas/devices for the user
```

### Investigate a sensor

```
1. Call GetLiveContext to get current value
2. Call ha_baseline to get normal range
3. Call ha_anomalies with current value to check if it's unusual
4. If anomalous, call ha_history for trend data
5. Suggest action if needed
```

### Energy analysis

```
1. Call ha_history for power/energy sensors over desired period
2. Call ha_baseline to establish normal consumption
3. Identify unusual spikes or patterns
4. Report findings with recommendations
```

### Respond to anomaly

```
1. Detect anomaly via ha_anomalies or context injection
2. Call ha_history for recent trend
3. If actionable (e.g., temperature too high), suggest or execute safe action
4. Call ha_notify to alert the user via Telegram
5. Store observation in Hindsight memory for future reference
```

## Important Notes

- **Entity IDs**: Use the format `domain.entity_name` (e.g., `sensor.kitchen_temperature`, `light.living_room`)
- **TimescaleDB has 256M+ rows**: Always specify time bounds. Don't query unbounded ranges
- **Numeric sensors only for baseline/anomaly**: Non-numeric states (on/off, open/closed) don't work with statistical analysis
- **Rate limiting**: Telegram notifications are throttled to 1 per 30 seconds. Don't spam alerts
- **Memory integration**: Store significant observations (anomalies, patterns, user preferences) in Hindsight using `memory_store` with bank `home-assistant`
