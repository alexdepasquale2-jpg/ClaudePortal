# feat-balance-simulator

Simulates many runs and reports how often each feat is earned, per track.

The design splits feats by end type so that dying is a different way of progressing rather than a
failure to progress. That only holds if all three tracks actually pay out — a Died track nobody
completes means dying really is just failing, whatever the design intended. This tool is how that
gets checked before players find out.
