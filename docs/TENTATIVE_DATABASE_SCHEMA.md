# BD CRM — tentative database schema

This diagram reflects the current FastAPI / SQLAlchemy models. It is a review draft: confirm field rules, retention, and reporting needs with the business team before treating it as the production contract.

```mermaid
erDiagram
    USERS {
        uuid id PK
        string email UK
        string full_name
        string password_hash
        string role
        boolean is_active
        boolean must_change_password
        int failed_login_attempts
        datetime locked_until
        datetime last_activity_at
        int token_version
        string password_reset_token_hash
        datetime password_reset_expires_at
    }

    ACCOUNTS {
        uuid id PK
        string name UK
        string status
        text description
    }

    CONTACTS {
        uuid id PK
        string stakeholder_id UK
        uuid account_id FK
        string full_name
        string designation
        string practice
        string location
        string email
        string phone
        string relationship_rating
        uuid owner_id FK
        uuid reports_to_id FK
        boolean route_via_vendor_management
        datetime last_activity_at
        text last_discussion
        text next_action
        datetime next_follow_up_at
        string engagement_stage
        decimal expected_annual_value
        decimal annual_target
    }

    ACTIVITIES {
        uuid id PK
        uuid contact_id FK
        uuid_array related_contact_ids
        datetime occurred_at
        string type
        string outcome
        string meeting_level
        text attendees
        string summary
        text next_action
        datetime next_action_due_at
        uuid next_action_owner_id FK
        uuid logged_by_id FK
    }

    TASKS {
        uuid id PK
        uuid contact_id FK
        text title
        uuid owner_id FK
        datetime due_at
        string status
        datetime completed_at
    }

    REQUIREMENTS {
        uuid id PK
        string requirement_code UK
        uuid contact_id FK
        uuid account_id FK
        uuid source_meeting_id FK
        string role_title
        text skills
        int positions_requested
        string experience_range
        string work_location
        string bd_owner
        datetime date_received
        string engagement_type
        decimal monthly_bill_rate
        int contract_months
        decimal fee_per_hire
        decimal project_value
        decimal expected_margin_percent
        decimal potential_revenue
        decimal potential_bottom_line
        decimal realised_revenue
        decimal realised_bottom_line
        string status
        string summary
    }

    POSITIONS {
        uuid id PK
        uuid requirement_id FK
        int position_number
        string status
        string candidate_name
        date joining_date
        decimal actual_bill_rate_or_fee
        decimal actual_margin_percent
    }

    DROPDOWN_VALUES {
        uuid id PK
        string category
        string value
        int sort_order
        boolean is_active
    }

    AUDIT_EVENTS {
        uuid id PK
        uuid user_id FK
        string action
        string entity_type
        uuid record_id
        string record_key
        json old_value
        json new_value
        datetime created_at
    }

    SAVED_CONTACT_VIEWS {
        uuid id PK
        uuid user_id FK
        string name
        string base_view
        text query
        string rating_filter
        string sort
        datetime created_at
    }

    RECENT_CONTACTS {
        uuid user_id PK, FK
        uuid contact_id PK, FK
        datetime viewed_at
    }

    NOTIFICATION_SETTINGS {
        int id PK
        text weekly_report_recipients
    }

    NOTIFICATION_RUNS {
        uuid id PK
        string kind
        date run_date
        datetime sent_at
    }

    ACCOUNTS ||--o{ CONTACTS : contains
    ACCOUNTS ||--o{ REQUIREMENTS : has
    USERS o|--o{ CONTACTS : owns
    CONTACTS o|--o{ CONTACTS : manages
    CONTACTS ||--o{ ACTIVITIES : has
    USERS o|--o{ ACTIVITIES : logs
    USERS o|--o{ ACTIVITIES : owns_next_action
    CONTACTS ||--o{ TASKS : has
    USERS ||--o{ TASKS : owns
    CONTACTS ||--o{ REQUIREMENTS : raises
    ACTIVITIES ||--o{ REQUIREMENTS : source_meeting
    REQUIREMENTS ||--o{ POSITIONS : includes
    USERS o|--o{ AUDIT_EVENTS : performs
    USERS ||--o{ SAVED_CONTACT_VIEWS : saves
    USERS ||--o{ RECENT_CONTACTS : views
    CONTACTS ||--o{ RECENT_CONTACTS : appears_in
```

## Relationship notes

- Each contact belongs to one account. A contact can optionally report to another contact and have an assigned BD owner.
- An activity has one primary contact. The model also stores related contact IDs in a PostgreSQL UUID array; this currently has no foreign-key validation.
- A requirement links the requesting contact, account, and source meeting. Its positions are stored as separate rows so each candidate and joining outcome can be tracked.
- A task is a follow-up assigned to a user and associated with a contact. Completing a task records its completion time.
- Audit events keep the acting user when available and store old/new values as JSON. `record_id` is polymorphic, so it intentionally does not point to one table; `record_key` retains readable business IDs.
- Dropdown values are grouped by category. Notification settings and runs are system-level records rather than user-owned rows.

## Review points before production

1. Consider replacing `activities.related_contact_ids` with an `activity_contacts` join table if multi-contact activities need referential integrity or filtering at scale.
2. Confirm whether `requirements.bd_owner` should become a foreign key to `users.id`, rather than storing a display name.
3. Confirm account/contact deletion and retention policy. Current foreign-key rules restrict deleting records used by CRM history, while audit events are append-only.
4. Add database checks or controlled lookup references for role, task status, relationship rating, engagement stage, requirement status, and non-negative commercial values.
5. Confirm currency and precision rules for all commercial amounts before finalizing numeric column precision.
