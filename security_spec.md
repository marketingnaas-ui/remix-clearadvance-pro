# Security Specification: ClearAdvance PRO

This document outlines the attribute-based access control (ABAC) invariants, the "Dirty Dozen" security threat vectors (payloads), and the test runner schema designed to enforce absolute security on ClearAdvance PRO's Firestore database.

## 1. Data Invariants

- **Advance requests** must belong to the logged-in employee (`employeeId` must match the registered `id` of the logged-in employee).
- **Clearing Logs** must reference a valid advance request document ID (`advId`) and are only readable/writable by users who have access to the associated advance request.
- **Clearing Items**, **Vault Files**, and **Audit Logs** must relate to a valid advance request document. Access is derived dynamically via the master advance request's `employeeId` using the "Master Gate" pattern.
- **Roles** (Employee, Manager, Accountant, Admin) are stored and looked up dynamically from the trusted `employees/{uid}` collection to prevent client-side claim spoofing.

---

## 2. The "Dirty Dozen" Malicious Payloads

The following malicious payloads must be rejected by the security rules:

1. **Identity Spoofing (Advance Creation)**: Standard Employee `emp-staff` attempts to create an advance request under Employee `emp-other`.
2. **Identity Spoofing (Employee Profile)**: Unauthenticated user attempts to update another employee's profile PIN or bank information.
3. **State Shortcutting (Employee Bypass)**: Employee attempts to bypass approval by creating an advance request with status set directly to `WAITING_TRANSFER` instead of `PENDING_APPROVAL`.
4. **State Shortcutting (Manager Bypass)**: Employee attempts to approve their own advance request.
5. **PII Blanket Read**: Standard employee attempts to fetch all files in `vaultFiles` without filtering by their own advances.
6. **Value Poisoning (Advance Amount)**: Creating an advance request with a negative `requestAmount` or a non-numeric value.
7. **Resource Poisoning (Junk document ID)**: Injected 1MB string as a document ID to exhaust Firestore resources or cause denial-of-service.
8. **Audit Trail Manipulation**: Standard employee attempts to overwrite or delete historical audit records in `auditLogs` to cover tracks.
9. **Duplicate Clearing Submissions**: Overwriting an already closed clearing log with new values.
10. **Clearing Item Unauthorized Injection**: Standard employee injecting unapproved receipts into another employee's active clearing log.
11. **Settings Hijacking**: Attempting to alter global configuration settings like available projects or running sequences maliciously.
12. **Orphaned Write Attack**: Creating a clearing log referencing a non-existent `advId`.

---

## 3. Test Runner Design

All security rules are validated to ensure permissions are denied under unauthorized operations, while authorized transactions are successfully permitted.
