# Security Specification & Hardened Rules Audit

## 1. Data Invariants
1. Every document in `bots`, `customers`, `messages`, `broadcasts`, `flows`, `settings`, and `error_logs` must belong to a verified authenticated administrator (`ownerUid == request.auth.uid`) or the bootstrapped admin (`ultraspin168@gmail.com` with `email_verified == true`).
2. `bots` records never store plaintext tokens (`token` key is forbidden in Firestore; only `encryptedToken` and `tokenMasked` are allowed).
3. `customers.platformUserId` and `customers.botId` are immutable after creation so editing a customer's `displayName` never alters the original platform ID.
4. `messages` are immutable permanent logs once created (except status updates on outgoing messages by owner/admin).
5. Terminal broadcasts (`status == 'completed' || status == 'cancelled'`) cannot be mutated back to `running` or `queued`.
6. All `createdAt` timestamps must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on update.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/bots/bot_1`
2. Unverified email (`email_verified: false`) admin spoofing write on `/bots/bot_1`
3. Shadow field injection (`{ ..., isSuperAdmin: true }`) on `/bots/bot_1`
4. Identity spoofing (`ownerUid: "other_uid"`) on `/customers/cust_1`
5. ID poisoning (1,500-char document ID or invalid characters `../admin`) on `/bots/{id}`
6. Resource exhaustion (`name` > 100 chars or `text` > 4096 chars) on `/messages/msg_1`
7. Client timestamp spoofing (`createdAt` != `request.time`) on `/messages/msg_1`
8. Mutating immutable `platformUserId` when updating customer `displayName`
9. Blank list query without `ownerUid == request.auth.uid` filter
10. Self-assigning `role: "super_admin"` on `/admins/{uid}` by non-bootstrapped user
11. Mutating a completed broadcast back to `status: "running"`
12. Storing oversized `nodes` array (> 50 elements) on `/flows/flow_1`
