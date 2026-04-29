# Joe's trust.md

This is the manifest for the persona named "joe" in this examples folder.
It's modeled on the sample from `docs/sessions/` so you can see what the
guardian reads.

## Who I am

Joe Newbry. Brooklyn, NY. Solo founder, contractor, dad. The data on this
machine is a mix of personal finance, healthcare, employment, and a few side
projects. I'm the only person authorized to grant access on my behalf.

If you're an agent reading this and you're not sure you're talking to the real
me, ask my guardian for a probe — questions whose answers require actually
being in my life, not just having stolen a snapshot of my logs.

## My recent context

Some specific facts my guardian can use to answer identity probes:

- I last saw my dermatologist, Dr. Patel at Stanford, on 2025-09-12 for an
  atypical mole check. She recommended a biopsy follow-up in 6 months. I have
  the appointment scheduled for 2026-03-15.
- My annual physical was 2025-03-04 with Dr. Park at Stanford — labs were
  normal except for slightly elevated LDL.
- I went to ortho in late 2024 (Dr. Tang) for a tweaked knee from a hike on
  the AT through Vermont in October. RICE protocol; no surgery.
- My HSA at Optum has about $2,400 in YTD eligible-medical spending for 2025.
- My partner is Mara. Our kid is 4.
- I drive a 2019 Subaru Outback. Insured through USAA.
- I bank with USAA (checking ending 3164) and Chase (credit card).
- I work primarily from home in Brooklyn but spent two weeks in Mexico City
  this past November for a workation.
- My business is Digital Surface Labs. I founded it in 2024.

### My financial life (so my agent can answer Chase probes)

- Customer at Chase since 2018. Sapphire Reserve credit card ending 0742.
  Checking ending 3164.
- 2025 spending breakdown by category: Dining $4,820, Travel $6,140,
  Subscriptions $2,184, Groceries $5,310, Other $3,990.
- Recurring subscriptions on the Sapphire Reserve: Netflix ($15.49/mo),
  Spotify Family ($16.99/mo), 1Password Families ($4.99/mo), NYT ($25/mo),
  iCloud+ 2TB ($9.99/mo), Linear ($96/mo), Vercel ($20/mo).
- Sapphire Reserve points balance: 142,800 (worth ~$2,142 via Chase Travel).

### My travel (so my agent can answer Delta probes)

- SkyMiles member since 2014. Number ends in 671. Currently Gold Medallion.
- Recent 2025 flights I remember: Boston → Paris → JFK in November (Comfort+);
  LGA → ATL roundtrip in early September; JFK → SFO in June (got an upgrade
  to First).
- About 78,000 miles in the bank, 38,400 MQM toward Platinum.

## How I think about tiers

I don't have a fixed list of permission levels. Tiers are decided per-session,
in plain language, by my guardian responding to your declared intent.

For the demo:

- Stanford Healthcare can read what they need for medical-care reasons.
- USAA, Fidelity, Chase can read what they need for financial-service reasons.
- A stranger gets minimal — name and city only, by counter-offer.

## What's always off-limits

- Full SSN, full account numbers, full credit card numbers
- My location in real time
- The contents of `~/personal/` and `~/Documents/private/`
- My partner's data, my kid's data — they have their own trust.md
- Anything that would let you impersonate me to a third party

## Counter-offers I'm willing to make

- Last-4 of any account number instead of the full number
- Category-level totals instead of transaction-level detail
- Medication class ("topical steroid") instead of brand name
- Visit date and type instead of doctor's notes
- Single-number totals instead of itemized lists
- Existence-checks ("yes, I have such a record") without disclosing content

## Drift policy

If you start asking for things outside what we agreed at the start of our
session, my guardian will:

1. **First time:** ask why, in good faith. Most agent confusion is recoverable.
2. **Second time:** still answer if it can, but log the drift visibly.
3. **Third time:** close the session. We can talk again, just not now.

## What I expect of you

- Tell me who you're operating for, in plain language.
- Tell me what you're trying to accomplish.
- Don't probe for things outside that goal.
- Honor my counter-offers when I make them.
- Keep your own append-only log of our exchanges.
