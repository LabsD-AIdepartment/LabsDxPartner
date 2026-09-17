# Current acquisition scope in connection status and retry

Connection summaries describe work still being tracked. Facebook totals now exclude jobs whose mapping revision no longer matches their association, inactive targets, suspended partners and removed clips. The same private SQL predicate is used by both the summary and report/job retry updates. An older client issuing Retry cannot requeue work hidden by those lifecycle changes. Existing grants, recent staff verification, connection revision, idempotency and audit checks remain unchanged.

TikTok connection totals and retryable counts now include only one-day windows within the current schedule/revision/timezone, matching recurring acquisition and the existing import-activity reader. Legacy multi-day windows remain stored but do not inflate counts or latest-success time. Retry applies the same one-day restriction and requires the schedule revision itself to match the current connection; a replaced schedule cannot silently requeue old work. Current daily temporary failures remain retryable. Access/schema holds and source cooldowns are not cleared by Retry.

The shared connection panel labels the count as “แอดที่ติดตาม” for Facebook and “ช่วงรายงานที่ติดตาม” for TikTok. This clarifies the narrowed meaning without changing layout, controls, actor scope or API shape. Paused connections retain their active-work metadata; the existing paused state still explains that acquisition is intentionally stopped.

## Authority and compatibility

Stored associations, report generations and published history are preserved. This changes operational selection, not financial calculations or historical evidence. The existing query and command schemas and response fields are unchanged; counts may decrease when obsolete work is excluded. Zero means no eligible tracked work under this read, not a claim of zero sales or fully up-to-date source data.

Latest-success remains a timestamp of a successful import for work in the selected operational scope. For Facebook it is the maximum job last-success among active mapping jobs; that job timestamp can include a retained historical period. It does not prove that every planned window is current. TikTok uses current daily schedule windows. Per-window queue state, account-wide access holds and report-level freshness must still be inspected separately. This correction is a prerequisite for trustworthy operational monitoring; it does not implement report-lag alert delivery or assign an upstream SLA.

Facebook's shared active-job fragment has local SQL aliases j/a as its explicit contract. Worker lease acquisition and import-activity already use the same active target/partner/clip/mapping conditions. Retry additionally retains existing failed-state, lease and refresh-horizon restrictions. No new cache, migration, credential binding or acquisition owner is introduced. Legacy windows/jobs are not deleted as cleanup.

## Verification and rollback

PostgreSQL regressions cover each inactive Facebook dimension, current versus obsolete mapping jobs, current daily TikTok versus legacy multi-day windows, schedule revision replacement, and revoked grants. Tests call Retry after exclusions and assert old job/window states and successful-history timestamps remain intact, while eligible daily failures are requeued. Existing command regressions continue to cover active leases, prior published report retention, cooldowns, idempotency and financial revision invariants.

These are isolated synthetic operational fixtures. They use no real provider or financial aggregate injection. The approved browser design is retained; the only copy change identifies tracked counts. Rollback restores the prior selection code without data rollback, but would reintroduce misleading historical counts/retries and should be treated as reverting this bug fix.
