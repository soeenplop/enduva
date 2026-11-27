// Worker entrypoint, a stub until task 0.12c: pg-boss jobs as `enduva_worker_login` over the session pooler, each
// in `withWorkerTx` (ADR-0002). For now it only proves that the build emits a second entrypoint.
process.stdout.write('worker stub: no jobs are registered yet (task 0.12c)\n');
