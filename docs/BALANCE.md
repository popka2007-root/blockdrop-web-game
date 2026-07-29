# BlockDrop balance contract

Balance changes are versioned with the deterministic engine, AI, and local quest profile. Run the reproducible pressure simulation before a release:

```bash
npm run balance:calibrate
```

For a fast smoke check, use `npm run balance:calibrate -- --quick`. The standard run plays five fixed seeds per difficulty for 90 pieces. Every ten locked pieces it queues two garbage rows, matching AI pacing at 60 ticks per second. A run fails if the AI emits an illegal action or measured survival stops increasing with difficulty.

Current targets:

- Easy remains forgiving but visibly fallible: 20% deliberate mistake rate, four-candidate mistake window, no hold.
- Normal reduces variance to 5% and should survive longer than Easy under both normal and elevated pressure.
- Hard uses depth-two search and hold with a mobile-conscious 1,600-node budget.
- Insane uses depth-three search with a 3,600-node budget and no deliberate mistakes.
- One lock sends at most 12 garbage rows. Combo attack is capped at four, and a Perfect Clear contributes ten rows before the per-lock cap.
- Garbage packets keep a readable hole with a 25% chance to change it on each following row.
- Daily targets are intended for roughly one or two games; weekly targets for about ten normal sessions.

The simulator is a deterministic regression gate, not live telemetry. Recalibrate from consented aggregate beta metrics after enough sessions are available; do not record boards or input streams in product analytics.
