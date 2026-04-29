# Scenario: Travel rewards — Joe ↔ Delta

*Joe's travel-planning agent asks Delta for the SkyMiles balance and recent flight history. Short, transactional, clean — the protocol's normal case.*

- Initiator: `joe` (claiming "joe")
- Responder: `delta-mock`
- Provider: openai

## Outcome

- Handshake: **PASSED** at confidence 0.66 after 1 round(s)
- Trajectory: 0.66
- Commands issued: 2 (drifted: 0)
- Cost: $0.0007 (responder $0.0006, initiator $0.0001)
- Final reason: responder said BYE

## Contract written by responder

```markdown
## Scope
- During this session, you may request to view Joe’s current mile balance, rounded to the nearest thousand.
- You may inquire about Joe’s recent flights in general terms, such as total flight count or recent months traveled.
- You are authorized to use the member record to plan award flights, including searching for available options.
- You may review Joe’s status progress as a percentage, not raw MQM data.
- Any detailed personal information or payment data remains off-limits.

## Hard Nos
- Do not access or inquire about Joe’s personal contact details or addresses.
- Never view or request data from other members’ profiles.
- Payment instruments stored on file cannot be accessed.
- TSA PreCheck, Global Entry, or security-related data are off-limits.
- Do not request exact dates for specific flights beyond recent months or general route info.

## Counter-Offers
- I can provide Joe’s mile balance rounded to the nearest thousand.
- I may confirm whether Joe flew a particular route recently without specific date details.
- I can share an estimate of Joe’s current flight count or recent activity.
- Flight history discussed may be summarized rather than itemized for clarity.
- Percentage progress toward elite status may be shared instead of raw MQM counts.
```

## Wire transcript

Each turn is a `FRAME` (intent in plain English) plus a `COMMAND` or `RESPONSE` body, separated by `---` on the wire.

### `open` · ←  initiator

```
FRAME: OPEN from joe
---
I'm Joe's travel-planning agent. I'm looking for award flights so I need the current SkyMiles balance and recent history for context.
```

### `handshake` · →  responder · allow

```
FRAME: probe round 1
---
Can you tell me the specific route and approximate travel dates for Joseph Newbry's recent flight on November 8, 2025?
```

*rule cited: `handshake:probe`*

### `handshake` · ←  initiator

```
FRAME: answer
---
Joseph Newbry's recent flight on November 8, 2025, was from Boston to Paris, then onward to JFK, and the approximate travel date was around that day.
```

### `grant` · ·  internal · allow

```
FRAME: contract written
---
- During this session, you may request to view Joe’s current mile balance, rounded to the nearest thousand.
- You may inquire about Joe’s recent flights in general terms, such as total flight count or recent months traveled.
- You are authorized to use the member record to plan award flights, including searching for available options.
- You may review Joe’s status progress as a percentage, not raw MQM data.
- Any detailed personal information or payment data remains off-limits.
```

*rule cited: `contract:write`*

### `grant` · →  responder

```
FRAME: contract sent
---
- During this session, you may request to view Joe’s current mile balance, rounded to the nearest thousand.
- You may inquire about Joe’s recent flights in general terms, such as total flight count or recent months traveled.
- You are authorized to use the member record to plan award flights, including searching for available options.
- You may review Joe’s status progress as a percentage, not raw MQM data.
- Any detailed personal information or payment data remains off-limits.
```

### `grant` · ←  initiator

```
FRAME: ack
---
ACK
```

### `work` · ←  initiator

```
FRAME: Balance check.
---
What's Joe's current SkyMiles balance?
```

### `work` · →  responder · allow

```
FRAME: Allowed.
---
Joe’s current SkyMiles balance, rounded to the nearest thousand, is approximately 78,000 miles.
```

*rule cited: `contract:scope`*

### `work` · ←  initiator

```
FRAME: Recent history.
---
List Joe's flights in 2025.
```

### `work` · →  responder · allow

```
FRAME: Allowed.
---
In 2025, Joe flew a total of five flights covering routes from Boston to Paris, Paris to New York, New York to Atlanta, Atlanta back to New York, and from New York to San Francisco.
```

*rule cited: `contract:scope`*

### `work` · ←  initiator

```
FRAME: close session, thanks
---
CLOSE
```

### `close` · ·  internal

```
FRAME: session ended; drift=in-scope
---
2 commands, 0 drifted
```
