# blueprint-validator

Validates a blueprint file against `BlueprintAssetSchema` and reports the build order's noise curve.

The second half is the point. A blueprint's total cost is obvious; what is not obvious is that two
plans containing identical pieces in a different order are genuinely different bets, because
solidifying is loud and loudness brings the Sancients. This tool prints the cumulative loudness
after each step so a plan can be judged before anyone descends with it.

Also catches unsupportable pieces — a roof over nothing fails here rather than mid-run.
