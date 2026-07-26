# Strategy Simulator

A small, deterministic Python engine for testing rule-based hypotheses against
synthetic or properly licensed observations.

This public repository intentionally contains only generic simulation
infrastructure and fictional examples. The live hypothesis, real thresholds,
operational records, and source data stay in the private
`market-hypothesis-lab/strategy-operations` repository.

## What is included

- Declarative rules with explicit operators, thresholds, and points
- Deterministic case evaluation
- A simple equity-path simulator using precomputed returns
- A validated signal lifecycle from trigger through entry, staged profit-taking,
  stop, and final exit
- Safe Discord payload previews routed to a strategy channel and an aggregate
  channel, with mentions disabled and deterministic delivery keys
- Synthetic JSON examples
- Unit tests and GitHub Actions CI

## Quick start

```powershell
git clone https://github.com/market-hypothesis-lab/strategy-simulator.git
cd strategy-simulator
python -m unittest discover -s tests -v
python -m strategy_simulator examples/demo-strategy.json examples/demo-case.json
```

The demo should return a score of `3` and `selected: true`.

To run the fictional end-to-end signal lifecycle and print the Discord
deliveries without sending anything:

```powershell
python -m strategy_simulator signal-preview examples/demo-signal-events.json
```

The final state should be `EXITED`. The example first realizes a staged profit
on 40 fictional shares, then applies the stop to the remaining 60. Every event
produces one strategy-specific delivery and one `all_signals` delivery. This
command never reads a webhook URL and never opens a network connection.

## Public/private boundary

Do not copy a live strategy configuration, unpublished results, real positions,
licensed market data, credentials, or webhook URLs into this repository. See
[DATA_POLICY.md](DATA_POLICY.md) for the complete boundary.

## License status

No open-source license has been selected yet. Public visibility permits reading
the repository but does not by itself grant rights to copy, modify, or
redistribute the source code.

## Disclaimer

This software is a research tool. It is not investment advice, a trading signal,
or an order-execution system.
