# Meme Launch Notification Platform Design

Date: 2026-03-29
Status: Approved for planning
Scope: Phase 1 only

## 1. Objective

Build a Phase 1 platform for retail users to discover new meme launch events and receive WeChat push notifications. The initial product must optimize for fast launch and a complete usable loop, not maximum extensibility.

Phase 1 covers:

- Public website showing the latest launch events
- Lightweight account system
- WeChat bot binding
- Per-source subscription management
- Three-day trial push experience
- One renewal reminder one day before expiry
- Automatic stop of push delivery after expiry
- BNB payment detection and automatic renewal

Out of scope for this spec:

- Twitter/X monitoring and push
- Search, ranking, analytics, or event detail pages
- Complex admin system
- Third-party payment gateways
- Signature-based wallet login

## 2. Product Scope

### 2.1 Target user

The primary user is a retail trader who wants to discover fresh meme launches quickly and jump directly into trading or discussion.

### 2.2 Event sources

Phase 1 supports exactly two sources from the existing demos:

- `four`
- `flap`

### 2.3 Website scope

The website remains intentionally small:

- Public homepage with the newest launch events
- Login and registration
- User center for WeChat binding, subscription settings, wallet address, and entitlement status
- Renewal page with payment instructions

### 2.4 Push scope

Push delivery is limited to WeChat bot messages. Users subscribe at source level:

- subscribe to `four`
- subscribe to `flap`

No keyword filters, heat thresholds, chain filters, or advanced rules are included in Phase 1.

## 3. Recommended System Approach

Use a lightweight event pipeline instead of a direct monolith or a full message platform.

Recommended architecture:

1. `collector-four`
2. `collector-flap`
3. `web-app`
4. `push-worker`
5. `wechat-bot-adapter`
6. `postgres`

Rationale:

- Faster to ship than a queue-heavy architecture
- Cleaner separation than putting collection, web traffic, and push delivery into one process
- Leaves a clear extension point for future Twitter/X collectors without redesigning the core model

The Phase 1 implementation should not introduce a dedicated MQ. Database tables will serve as the lightweight storage and job coordination layer.

## 4. Core Components

### 4.1 `collector-four`

Derived from `demo/four.event.ts`.

Responsibilities:

- Listen to the `four` contract events
- Normalize incoming event payloads
- Generate a stable dedupe key
- Insert launch events into the database

### 4.2 `collector-flap`

Derived from `demo/flap.event.ts`.

Responsibilities:

- Listen to the `flap` contract events
- Normalize incoming payloads
- Insert launch events into the database

### 4.3 `web-app`

Responsibilities:

- Render the public homepage event feed
- Provide login and registration
- Show user status and renewal state
- Let users bind WeChat
- Let users manage source subscriptions
- Show renewal instructions and payment status

### 4.4 `push-worker`

Responsibilities:

- Scan newly created launch events
- Find users eligible to receive each event
- Create or process push jobs
- Send WeChat messages through the adapter
- Create system reminder jobs

### 4.5 `wechat-bot-adapter`

Responsibilities:

- Encapsulate the `weixin-agent-sdk` integration
- Generate binding instructions or bind codes
- Receive or validate WeChat-side binding actions
- Deliver push messages and system reminders

### 4.6 `payment-watcher`

Responsibilities:

- Watch inbound BNB transfers to the fixed collection wallet
- Match transfers to a registered user wallet
- Record payment records
- Convert BNB amounts into credited days
- Extend entitlements exactly once per transaction hash

This watcher can be a dedicated process or part of the worker, but the logical responsibility must remain isolated.

## 5. Data Model

Phase 1 uses a minimal but explicit schema.

### 5.1 `users`

Stores account information.

Suggested fields:

- `id`
- `email` or other lightweight login field
- `password_hash`
- `wallet_address`
- `wallet_address_updated_at`
- `created_at`
- `updated_at`

### 5.2 `user_wechat_bindings`

Stores the WeChat binding relation.

Suggested fields:

- `id`
- `user_id`
- `wechat_user_id`
- `bind_status`
- `bind_code`
- `bound_at`
- `last_error`

### 5.3 `launch_events`

Stores normalized launch events for all sources.

Suggested fields:

- `id`
- `source`
- `source_event_id`
- `token_address`
- `symbol`
- `title`
- `event_time`
- `chain`
- `raw_payload`
- `dedupe_key`
- `created_at`

`dedupe_key` should be unique. A good default is `source + tx_hash + log_index`.

### 5.4 `user_source_subscriptions`

Stores per-user source subscriptions.

Suggested fields:

- `id`
- `user_id`
- `source`
- `enabled`
- `created_at`
- `updated_at`

### 5.5 `user_entitlements`

Stores whether the user is currently eligible to receive push notifications.

Suggested fields:

- `id`
- `user_id`
- `plan_type` with values such as `trial` or `paid`
- `status` with values such as `active` or `expired`
- `starts_at`
- `expires_at`
- `renewal_reminded_at`
- `source` for audit metadata, for example `trial_signup` or `bnb_payment`
- `created_at`
- `updated_at`

For Phase 1, a user is treated as eligible if there is an active entitlement whose expiry time has not passed.

### 5.6 `notification_jobs`

Stores launch-event push jobs.

Suggested fields:

- `id`
- `launch_event_id`
- `user_id`
- `channel` with value `wechat`
- `status` with values such as `pending`, `sent`, `failed`, `skipped`
- `attempt_count`
- `last_error`
- `sent_at`
- `created_at`

### 5.7 `system_message_jobs`

Stores non-event messages such as renewal reminders.

Suggested fields:

- `id`
- `user_id`
- `message_type` such as `renewal_reminder`
- `payload`
- `status`
- `attempt_count`
- `last_error`
- `sent_at`
- `created_at`

### 5.8 `payment_records`

Stores BNB payment detection and application results.

Suggested fields:

- `id`
- `user_id`
- `from_wallet_address`
- `to_wallet_address`
- `tx_hash`
- `amount_bnb`
- `credited_days`
- `status` with values such as `detected`, `applied`, `ignored`, `manual_review`
- `paid_at`
- `raw_payload`
- `created_at`

`tx_hash` must be unique to prevent duplicate entitlement extension.

## 6. Core Business Rules

### 6.1 Event visibility

- Homepage is public
- Latest events are visible without login
- Homepage rendering does not depend on push delivery success

### 6.2 Subscription model

- Users can enable or disable `four`
- Users can enable or disable `flap`
- Push is source-based only

### 6.3 Trial model

- A newly registered user who successfully completes WeChat binding receives a three-day trial
- The trial is represented as a `trial` entitlement
- Trial users can receive launch pushes from the sources they subscribed to

### 6.4 Reminder model

- A renewal reminder is sent exactly once
- Reminder timing is one day before `expires_at`
- The reminder is delivered over WeChat
- `renewal_reminded_at` prevents duplicates

### 6.5 Expiry model

- After `expires_at`, new launch pushes stop
- The user can still access the website and see the homepage
- The user center should clearly show the expired state

### 6.6 Payment pricing

Phase 1 pricing is fixed:

- promotional price: `0.005 BNB = 30 days`
- original price: `0.01 BNB` is display copy only and does not affect the automatic pricing logic

Automatic crediting follows the promotional unit price linearly:

- `0.005 BNB = 30 days`
- `0.01 BNB = 60 days`

The automatic rule for Phase 1 is:

- each `0.005 BNB` paid credits `30 days`

This rule is fixed in code for Phase 1 and is not driven by a dynamic pricing configuration panel.

### 6.7 Collection wallet

The fixed receiving wallet address is:

`0xaCEa067c6751083e4e652543A436638c1e777777`

### 6.8 Payment matching

- A user must register a wallet address in the account profile before paying
- Only transfers from the registered wallet to the collection wallet qualify for automatic renewal
- A payment can only be applied once per `tx_hash`

### 6.9 Renewal extension

When a qualifying payment is detected:

- if the user is still active, extend from the current `expires_at`
- if the user is already expired, extend from the payment time

## 7. User Flows

### 7.1 Public discovery flow

1. User opens the homepage
2. User sees the latest launch events from `four` and `flap`
3. User can use trading or discussion links directly from each event item
4. User decides to register for WeChat push

### 7.2 Registration and binding flow

1. User registers or logs in
2. User enters the user center
3. User sees WeChat binding instructions or a bind code
4. User completes the binding action through the WeChat bot
5. System marks the binding as successful
6. System grants a three-day trial entitlement if this is the first eligible activation

### 7.3 Subscription flow

1. User opens the user center
2. User enables or disables `four`
3. User enables or disables `flap`
4. Future push delivery follows the current subscription state

### 7.4 Renewal flow

1. User enters the renewal page
2. User sees:
   - current price `0.005 BNB / 30 days`
   - collection wallet address
   - the user's registered wallet
   - notice that renewal is automatic after on-chain receipt
3. User transfers BNB from the registered wallet
4. System detects the transfer and applies credited days
5. User center shows the updated expiry time

### 7.5 Reminder and expiry flow

1. One day before expiry, the system creates a renewal reminder
2. The WeChat bot delivers the reminder once
3. If the user does not renew, push delivery stops after expiry

## 8. Data Flows

### 8.1 Launch event ingestion

1. A collector receives an on-chain event
2. The collector normalizes the payload
3. The collector computes the dedupe key
4. The collector inserts into `launch_events`
5. The homepage can now show the event

### 8.2 Launch push dispatch

1. The worker selects newly inserted launch events
2. The worker finds users who:
   - have an active WeChat binding
   - subscribed to the event source
   - have a valid non-expired entitlement
3. The worker creates or processes `notification_jobs`
4. The WeChat adapter sends the message
5. Job status is updated to `sent`, `failed`, or `skipped`

### 8.3 Renewal reminder dispatch

1. A scheduled worker scans entitlements expiring within one day
2. It filters out entitlements with an existing `renewal_reminded_at`
3. It creates `system_message_jobs`
4. The WeChat adapter delivers the reminder
5. `renewal_reminded_at` is recorded

### 8.4 Payment application

1. The payment watcher observes inbound transfers to the collection wallet
2. It verifies the sender address matches a registered user wallet
3. It records the payment in `payment_records`
4. It converts the payment amount into credited days according to the fixed promotional unit
5. It extends the user's entitlement
6. It marks the payment as `applied`

## 9. Failure Handling

### 9.1 Collector disconnects

- Collectors must automatically reconnect
- Duplicate event ingestion after reconnect is acceptable if the database uniqueness constraint prevents duplicate storage

### 9.2 Partial event metadata

- Missing symbol or other metadata must not block event ingestion
- The UI may fall back to token address when metadata is incomplete

### 9.3 WeChat send failure

- Push failure must not block event ingestion or homepage rendering
- Failed jobs should be retried a limited number of times, such as three attempts

### 9.4 Invalid binding state

- Binding problems should be visible in the user center
- Users must be able to rebind
- Worker logic should not keep attempting delivery forever to obviously invalid bindings

### 9.5 Payment mismatch

- Payments from unknown wallets should not auto-credit a user
- They should be recorded as `ignored` or `manual_review`

### 9.6 Duplicate reminder prevention

- Reminder sends must be idempotent per entitlement period

## 10. UI Surface

### 10.1 Homepage

Shows the newest launch events in reverse chronological order.

Each item should emphasize:

- source
- symbol or token name
- token address
- event time
- quick links such as trade, discussion, and X search

### 10.2 Login and registration page

Provides lightweight account access. The initial implementation should stay minimal.

### 10.3 User center

Shows:

- WeChat binding state
- binding instructions or bind code
- wallet address
- entitlement state
- expiry time
- source subscription toggles

### 10.4 Renewal page

Shows:

- current effective price
- collection wallet address
- user's registered wallet address
- payment instructions
- notice that receipt triggers automatic renewal

## 11. Technical Direction

Recommended stack:

- TypeScript across the whole project
- Next.js for the web app and basic API surface
- PostgreSQL for persistence
- Prisma or an equivalent ORM for migrations and schema access
- `viem` for event watching
- `weixin-agent-sdk` isolated behind `wechat-bot-adapter`

Recommended logical project structure:

- `apps/web`
- `apps/collector`
- `apps/worker`
- `packages/shared`

This keeps deployment lightweight while preserving code boundaries.

## 12. Verification Targets

Before Phase 1 is considered ready, verify:

1. `four` events can be ingested, deduplicated, stored, and displayed
2. `flap` events can be ingested, deduplicated, stored, and displayed
3. A user can register and complete WeChat binding
4. First successful binding grants a three-day trial
5. Source subscription controls which launch events are pushed
6. A renewal reminder is sent once one day before expiry
7. No new launch pushes are sent after expiry
8. A qualifying BNB transfer to the collection wallet extends entitlement automatically
9. `0.01 BNB` is credited as `60 days`
10. Push failures do not block public event visibility

## 13. Deferred Work

Explicitly deferred to later phases:

- Twitter/X monitoring and push
- Event detail pages
- Search and ranking
- Analytics dashboards
- Full operations console
- Dynamic pricing management
- Wallet signature verification
- Multi-wallet support
- Refund workflows

## 14. Constraints and Notes

- The design deliberately prioritizes launch speed over a generalized notification platform.
- Future Twitter/X ingestion should fit by adding another collector and mapping into the existing `launch_events` model or a sibling unified content model.
