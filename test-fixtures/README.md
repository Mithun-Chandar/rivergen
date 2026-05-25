# test-fixtures

Minimal broken-scenario directories used in [docs/examples/failure-lab.md](https://github.com/Mithun-Chandar/rivergen/blob/main/docs/examples/failure-lab.md).

Each scenario isolates a single gate violation so you can run `rivergen verify` against it and see the exact error output described in the failure lab.

```sh
rivergen verify --root test-fixtures/scenario-01
```

| Scenario    | Gate   | Violation                                          |
| ----------- | ------ | -------------------------------------------------- |
| scenario-01 | #1     | Direct `socket.emit()` in mutation file            |
| scenario-02 | #1     | Direct `eventBus.publish()` in mutation file       |
| scenario-03 | #2     | EventBus listener missing                          |
| scenario-04 | #7     | Schema `z.object()` missing `.strict()`            |
| scenario-05 | #5     | `io.emit()` with no room target                    |
| scenario-06 | #8     | `WebSocketProvider` imports entity-cache directly  |
| scenario-07 | #9     | `queryClient.invalidateQueries` inside `onSuccess` |
| scenario-08 | #10    | `useMutation` missing `onMutate`                   |
| scenario-09 | #12 L1 | Witness `requiredField` absent from Zod schema     |
| scenario-10 | #12 L2 | Broadcast drops a required field                   |
| scenario-11 | #12 L3 | Static import of React-dependent file in witness   |
| scenario-12 | #12 L4 | Projection assertion failure in `lifecycle()`      |
