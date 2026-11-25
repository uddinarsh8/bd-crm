from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import smtplib
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
import csv
import io
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.database import Base, engine, get_db
from app.models import (Account, Activity, AuditEvent, Contact, DropdownValue, FollowUpTask,
                        NotificationSetting, Position, RecentContact, Requirement, SavedContactView, User)
from app.settings import settings

app = FastAPI(title="BD CRM API", version="1.0.0", description="BD CRM shared backend using FastAPI and PostgreSQL")
app.add_middleware(CORSMiddleware, allow_origins=[item.strip() for item in settings.allowed_origins.split(",") if item.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DEFAULTS = {
    "Location": ["Bangalore", "Chennai", "Coimbatore", "Delhi", "Gurgaon", "Hyderabad", "Mumbai", "Noida", "Pune", "US", "Japan", "Romania", "Other"],
    "RelationshipRating": ["Hot", "Warm", "Slightly Warm", "Cold", "Parked"],
    "ActivityType": ["Call", "Email", "LinkedIn", "WhatsApp", "Meeting (formal)", "Meeting (informal)", "Event"],
    "ActivityOutcome": ["Connected", "No Answer", "Call Back Later", "Route via Vendor Management", "Not Interested"],
    "RequirementStatus": ["New", "Profiles Shared", "Interviews", "Offer Made", "Partially Filled", "Closed Won", "Closed Lost", "On Hold"],
}
STAGES = ["Mapped", "Contacted", "Connected", "L1", "L2", "L3", "Requirement"]
ROLE_NAMES = {"Administrator": "Administrator", "BDLead": "BDLead", "BD Lead": "BDLead", "User": "User", "Leader": "Leader"}

if settings.create_schema_on_start:
    Base.metadata.create_all(engine)


def encode_token(data: dict[str, Any]) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps(data, separators=(",", ":")).encode())
    signature = b64(hmac.new(settings.jwt_secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def decode_token(token: str) -> dict[str, Any]:
    try:
        header, payload, signature = token.split(".")
        expected = b64(hmac.new(settings.jwt_secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected): raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data.get("iss") != settings.jwt_issuer or data.get("aud") != settings.jwt_audience or data.get("exp", 0) < int(datetime.now(timezone.utc).timestamp()): raise ValueError()
        return data
    except Exception as exc:
        raise HTTPException(401, "Sign in again.") from exc


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${b64(salt)}${b64(digest)}"


def verify_password(password: str, saved: str) -> bool:
    try:
        scheme, salt, digest = saved.split("$")
        actual = hashlib.scrypt(password.encode(), salt=base64.urlsafe_b64decode(salt + "=" * (-len(salt) % 4)), n=2**14, r=8, p=1)
        return scheme == "scrypt" and hmac.compare_digest(b64(actual), digest)
    except Exception:
        return False


def caller(request: Request, authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "): raise HTTPException(401, "Sign in required.")
    claims = decode_token(authorization[7:])
    user = db.get(User, claims.get("sub"))
    if user is None or not user.is_active or user.token_version != claims.get("ver"): raise HTTPException(401, "Sign in again.")
    if user.last_activity_at and datetime.now(timezone.utc) - user.last_activity_at > timedelta(minutes=30):
        user.token_version += 1; db.commit(); raise HTTPException(401, "Your session expired after 30 minutes of inactivity.")
    user.last_activity_at = datetime.now(timezone.utc); db.commit()
    if user.must_change_password and request.url.path != "/api/auth/change-password": raise HTTPException(403, "Change your password before using the CRM.")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(caller)) -> User:
        if user.role not in roles: raise HTTPException(403, "You do not have permission to do this.")
        return user
    return dependency


def audit(db: Session, user: User | None, action: str, entity: str, record_id: str | None = None, key: str | None = None, old: Any = None, new: Any = None):
    db.add(AuditEvent(user_id=user.id if user else None, action=action, entity_type=entity, record_id=record_id, record_key=key, old_value=jsonable(old), new_value=jsonable(new)))


def jsonable(value: Any) -> Any:
    if value is None: return None
    if hasattr(value, "__dict__") and not isinstance(value, type): return {k: jsonable(v) for k, v in value.__dict__.items() if not k.startswith("_")}
    if isinstance(value, dict): return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [jsonable(v) for v in value]
    if isinstance(value, (datetime, date)): return value.isoformat()
    if isinstance(value, UUID): return str(value)
    return value


def send_email(to: str, subject: str, body: str) -> bool:
    if not settings.smtp_host or not settings.smtp_from: return False
    message = EmailMessage(); message["From"] = settings.smtp_from; message["To"] = to; message["Subject"] = subject; message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.starttls()
        if settings.smtp_username: server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)
    return True


def check_lookup(db: Session, category: str, value: str | None) -> bool:
    if value is None: return True
    configured = db.scalars(select(DropdownValue).where(DropdownValue.category == category)).all()
    return value in [x.value for x in configured if x.is_active] if configured else value in DEFAULTS.get(category, [])


def contact_view(db: Session, c: Contact, can_view_margins: bool = True) -> dict[str, Any]:
    result = {"id": c.id, "stakeholderId": c.stakeholder_id, "account": c.account.name, "accountId": c.account_id, "fullName": c.full_name, "designation": c.designation, "practice": c.practice, "location": c.location, "email": c.email, "phone": c.phone, "relationshipRating": c.relationship_rating, "ownerId": c.owner_id, "owner": c.owner.full_name if c.owner else None, "reportsToId": c.reports_to_id, "reportsTo": c.reports_to.full_name if c.reports_to else None, "routeViaVendorManagement": c.route_via_vendor_management, "lastActivityAt": jsonable(c.last_activity_at), "lastDiscussion": c.last_discussion, "nextAction": c.next_action, "nextFollowUpAt": jsonable(c.next_follow_up_at), "engagementStage": c.engagement_stage, "expectedAnnualValue": c.expected_annual_value}
    if can_view_margins: result["annualTarget"] = c.annual_target
    return result


def activity_view(a: Activity, allowed_ids: set[str] | None = None) -> dict[str, Any]:
    ids = list(dict.fromkeys([a.contact_id, *(a.related_contact_ids or [])]))
    if allowed_ids is not None: ids = [i for i in ids if i in allowed_ids]
    return {"id": a.id, "contactId": a.contact_id, "contactIds": ids, "contact": a.contact.full_name, "occurredAt": jsonable(a.occurred_at), "type": a.type, "outcome": a.outcome, "meetingLevel": a.meeting_level, "attendees": a.attendees, "summary": a.summary, "nextAction": a.next_action, "nextActionDueAt": jsonable(a.next_action_due_at), "loggedBy": a.logged_by.full_name if a.logged_by else None}


def requirement_view(r: Requirement, can_view_margins: bool = True) -> dict[str, Any]:
    result = {"id": r.id, "requirementCode": r.requirement_code, "contactId": r.contact_id, "contact": r.contact.full_name, "accountId": r.account_id, "account": r.account.name, "sourceMeetingId": r.source_meeting_id, "roleTitle": r.role_title, "skills": r.skills, "positionsRequested": r.positions_requested, "experienceRange": r.experience_range, "workLocation": r.work_location, "bdOwner": r.bd_owner, "dateReceived": jsonable(r.date_received), "engagementType": r.engagement_type, "monthlyBillRate": r.monthly_bill_rate, "contractMonths": r.contract_months, "feePerHire": r.fee_per_hire, "projectValue": r.project_value, "potentialRevenue": r.potential_revenue, "realisedRevenue": r.realised_revenue, "status": r.status, "summary": r.summary, "positions": [{"id": p.id, "positionNumber": p.position_number, "status": p.status, "candidateName": p.candidate_name, "joiningDate": jsonable(p.joining_date), "actualBillRateOrFee": p.actual_bill_rate_or_fee} for p in r.positions]}
    if can_view_margins:
        result.update({"expectedMarginPercent": r.expected_margin_percent, "potentialBottomLine": r.potential_bottom_line, "realisedBottomLine": r.realised_bottom_line})
        for position, item in zip(r.positions, result["positions"]): item["actualMarginPercent"] = position.actual_margin_percent
    return result


def default_margin(db: Session, engagement_type: str) -> float:
    category = f"DefaultMarginPercent:{engagement_type}"
    item = db.scalar(select(DropdownValue).where(DropdownValue.category == category, DropdownValue.is_active.is_(True)).order_by(DropdownValue.sort_order))
    if item is None:
        item = db.scalar(select(DropdownValue).where(DropdownValue.category == "DefaultMarginPercent", DropdownValue.is_active.is_(True)).order_by(DropdownValue.sort_order))
    try: return float(item.value) if item else 20.0
    except (ValueError, TypeError): return 20.0


@app.get("/health")
def health(): return {"ok": True, "service": "BD CRM FastAPI", "database": "PostgreSQL"}


@app.post("/api/auth/bootstrap-admin", status_code=201)
def bootstrap_admin(data: dict[str, Any], db: Session = Depends(get_db)):
    if not settings.bootstrap_key or not hmac.compare_digest(str(data.get("key", "")), settings.bootstrap_key): raise HTTPException(401, "Invalid bootstrap key.")
    if db.scalar(select(User.id).limit(1)): raise HTTPException(409, "Initial administrator setup has already been completed.")
    password = str(data.get("password", ""))
    if len(password) < 12 or not any(c.isupper() for c in password) or not any(c.islower() for c in password) or not any(c.isdigit() for c in password) or not any(not c.isalnum() for c in password): raise HTTPException(400, "Password must be 12+ characters with upper/lowercase, a number, and a symbol.")
    user = User(email=data["email"].strip().lower(), full_name=data["fullName"].strip(), role="Administrator", password_hash=hash_password(password), must_change_password=False)
    db.add(user); db.flush(); audit(db, user, "Initial administrator created", "User", user.id, user.email, new="Administrator"); db.commit()
    return {"id": user.id, "email": user.email, "fullName": user.full_name, "role": user.role}


@app.post("/api/auth/login")
def login(data: dict[str, Any], request: Request, db: Session = Depends(get_db)):
    email = str(data.get("email", "")).strip().lower(); user = db.scalar(select(User).where(User.email == email)); now = datetime.now(timezone.utc)
    if user is None or not user.is_active:
        audit(db, None, "Failed login", "User", key=email, new="Invalid credentials"); db.commit(); raise HTTPException(401, "Invalid email or password.")
    if user.locked_until and user.locked_until > now: raise HTTPException(423, "Account is temporarily locked. Try again later.")
    if not verify_password(str(data.get("password", "")), user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5: user.locked_until = now + timedelta(minutes=15); user.failed_login_attempts = 0
        audit(db, user, "Failed login", "User", user.id, email, new="Account locked for 15 minutes" if user.locked_until else "Invalid credentials"); db.commit(); raise HTTPException(401, "Invalid email or password.")
    user.failed_login_attempts = 0; user.locked_until = None; user.last_activity_at = now
    token = encode_token({"sub": user.id, "role": user.role, "name": user.full_name, "ver": user.token_version, "iss": settings.jwt_issuer, "aud": settings.jwt_audience, "iat": int(now.timestamp()), "exp": int((now + timedelta(hours=8)).timestamp())})
    audit(db, user, "Login", "User", user.id, email, new="Succeeded"); db.commit()
    return {"accessToken": token, "tokenType": "Bearer", "expiresInSeconds": 28800, "mustChangePassword": user.must_change_password, "user": {"id": user.id, "email": user.email, "fullName": user.full_name, "role": user.role}}


@app.post("/api/auth/forgot-password")
def forgot_password(data: dict[str, Any], db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(data.get("email", "")).strip().lower(), User.is_active.is_(True)))
    if user:
        token = secrets.token_urlsafe(32); user.password_reset_token_hash = hashlib.sha256(token.encode()).hexdigest(); user.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        url = f"{settings.frontend_base_url}/login?email={user.email}&token={token}"
        send_email(user.email, "Reset your BD CRM password", f"Use this one-time link within 30 minutes:\n{url}")
        audit(db, user, "Password reset requested", "User", user.id, user.email, new="Reset link issued")
    db.commit(); return {"message": "If this account is active, a reset link has been sent."}


@app.post("/api/auth/reset-password")
def reset_password(data: dict[str, Any], db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(data.get("email", "")).strip().lower(), User.is_active.is_(True)))
    token_hash = hashlib.sha256(str(data.get("token", "")).encode()).hexdigest()
    if not user or not user.password_reset_token_hash or not hmac.compare_digest(user.password_reset_token_hash, token_hash) or not user.password_reset_expires_at or user.password_reset_expires_at < datetime.now(timezone.utc): raise HTTPException(400, "This reset link is invalid or expired.")
    password = str(data.get("newPassword", ""))
    if len(password) < 12 or not any(c.isupper() for c in password) or not any(c.islower() for c in password) or not any(c.isdigit() for c in password) or not any(not c.isalnum() for c in password): raise HTTPException(400, "Password must be 12+ characters with upper/lowercase, a number, and a symbol.")
    user.password_hash = hash_password(password); user.must_change_password = False; user.password_reset_token_hash = None; user.password_reset_expires_at = None; user.token_version += 1
    audit(db, user, "Password reset completed", "User", user.id, user.email, new="Password changed"); db.commit(); return {"message": "Password reset complete."}


@app.post("/api/auth/change-password")
def change_password(data: dict[str, Any], user: User = Depends(caller), db: Session = Depends(get_db)):
    if not verify_password(str(data.get("currentPassword", "")), user.password_hash): raise HTTPException(400, "Current password is incorrect.")
    password = str(data.get("newPassword", ""))
    if len(password) < 12 or not any(c.isupper() for c in password) or not any(c.islower() for c in password) or not any(c.isdigit() for c in password) or not any(not c.isalnum() for c in password): raise HTTPException(400, "Password must be 12+ characters with upper/lowercase, a number, and a symbol.")
    user.password_hash = hash_password(password); user.must_change_password = False; user.token_version += 1
    audit(db, user, "Password changed", "User", user.id, user.email, new="Password changed"); db.commit(); return {"message": "Password changed. Sign in again."}


@app.get("/api/lookups")
def lookups(user: User = Depends(caller), db: Session = Depends(get_db)):
    result = {key: list(value) for key, value in DEFAULTS.items()}
    rows = db.scalars(select(DropdownValue).where(DropdownValue.is_active.is_(True)).order_by(DropdownValue.sort_order)).all()
    for row in rows: result.setdefault(row.category, []).append(row.value)
    result["DefaultMargins"] = {kind: str(default_margin(db, kind)) for kind in ("Contract", "Permanent hire", "Project/RPO")}
    return result


def visible_contacts(db: Session, user: User):
    query = select(Contact).options(joinedload(Contact.account), joinedload(Contact.owner), joinedload(Contact.reports_to)).order_by(Contact.full_name)
    if user.role == "User": query = query.where(Contact.owner_id == user.id)
    return db.scalars(query).unique().all()


@app.get("/api/accounts")
def accounts(user: User = Depends(caller), db: Session = Depends(get_db)):
    items = db.scalars(select(Account).options(joinedload(Account.contacts), joinedload(Account.requirements).joinedload(Requirement.contact)).order_by(Account.name)).unique().all(); result = []
    for a in items:
        cs = [c for c in a.contacts if user.role != "User" or c.owner_id == user.id]
        rs = [r for r in a.requirements if user.role != "User" or r.contact.owner_id == user.id]
        result.append({"id": a.id, "name": a.name, "status": a.status, "description": a.description, "contacts": len(cs), "requirements": len(rs), "openRequirements": sum(r.status not in ("Closed Won", "Closed Lost") for r in rs), "potentialRevenue": sum(float(r.potential_revenue or 0) for r in rs), "realisedRevenue": sum(float(r.realised_revenue or 0) for r in rs)})
    return result


@app.post("/api/accounts", status_code=201)
def create_account(data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead")), db: Session = Depends(get_db)):
    name = str(data.get("name", "")).strip()
    if not name or len(name) > 160: raise HTTPException(400, "Account name is required and must be at most 160 characters.")
    if data.get("status", "Active") not in ("Active", "Inactive"): raise HTTPException(400, "Account status must be Active or Inactive.")
    if db.scalar(select(Account.id).where(func_lower(Account.name) == name.lower())): raise HTTPException(409, "This account already exists.")
    item = Account(name=name, description=data.get("description"), status=data.get("status", "Active")); db.add(item); db.flush(); audit(db, user, "Account created", "Account", item.id, item.name, new={"name": item.name, "status": item.status}); db.commit()
    return {"id": item.id, "name": item.name, "status": item.status, "description": item.description}


def func_lower(column):
    from sqlalchemy import func
    return func.lower(column)


@app.patch("/api/accounts/{account_id}")
def update_account(account_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead")), db: Session = Depends(get_db)):
    item = db.get(Account, account_id)
    if not item: raise HTTPException(404, "Account not found.")
    before = {"name": item.name, "status": item.status, "description": item.description}; name = str(data.get("name", item.name)).strip(); status = data.get("status", item.status)
    if not name or len(name) > 160 or status not in ("Active", "Inactive"): raise HTTPException(400, "Enter a valid account name and status.")
    duplicate = db.scalar(select(Account.id).where(func_lower(Account.name) == name.lower(), Account.id != item.id))
    if duplicate: raise HTTPException(409, "This account already exists.")
    item.name = name; item.status = status; item.description = data.get("description"); audit(db, user, "Account updated", "Account", item.id, item.name, before, {"name": item.name, "status": item.status, "description": item.description}); db.commit()
    return {"id": item.id, "name": item.name, "status": item.status, "description": item.description}


@app.get("/api/contacts")
def contacts(search: str | None = None, rating: str | None = None, practice: str | None = None, quiet: bool = False, user: User = Depends(caller), db: Session = Depends(get_db)):
    query = select(Contact).options(joinedload(Contact.account), joinedload(Contact.owner), joinedload(Contact.reports_to))
    if user.role == "User": query = query.where(Contact.owner_id == user.id)
    if rating: query = query.where(Contact.relationship_rating == rating)
    if practice: query = query.where(Contact.practice == practice)
    if search:
        like = f"%{search}%"; query = query.join(Account).where(or_(Contact.full_name.ilike(like), Contact.email.ilike(like), Account.name.ilike(like), Contact.designation.ilike(like), Contact.practice.ilike(like)))
    if quiet: query = query.where(or_(Contact.last_activity_at.is_(None), Contact.last_activity_at < datetime.now(timezone.utc) - timedelta(days=30)))
    return [contact_view(db, item, user.role != "User") for item in db.scalars(query.order_by(Contact.full_name)).unique().all()]


def check_contact_write(db: Session, data: dict[str, Any], user: User, item: Contact | None = None):
    name = str(data.get("fullName", "")).strip(); account_id = data.get("accountId"); location = data.get("location"); rating = data.get("relationshipRating")
    account = db.get(Account, account_id) if account_id else None
    if not name or not location or not rating or not account: raise HTTPException(400, "Name, account, location, and relationship rating are required.")
    if not check_lookup(db, "Location", location) or not check_lookup(db, "RelationshipRating", rating): raise HTTPException(400, "Choose an approved location and relationship rating.")
    owner_id = user.id if user.role == "User" else data.get("ownerId") or user.id
    owner = db.get(User, owner_id)
    if not owner or not owner.is_active: raise HTTPException(400, "Choose an active contact owner.")
    manager_id = data.get("reportsToId")
    if manager_id:
        manager = db.get(Contact, manager_id)
        if not manager or manager.account_id != account.id or (item and manager.id == item.id): raise HTTPException(400, "Choose a manager at the same account, not the contact itself.")
    if item and user.role == "User" and item.owner_id != user.id: raise HTTPException(404, "Contact not found.")
    if item and user.role == "User" and owner_id != item.owner_id: raise HTTPException(403, "Users cannot reassign contacts.")
    email = str(data.get("email") or "").strip().lower() or None
    query = select(Contact).where(Contact.id != (item.id if item else ""), or_(Contact.email == email if email else False, (func_lower(Contact.full_name) == name.lower()) & (Contact.account_id == account.id) & (Contact.reports_to_id == manager_id)))
    duplicate = db.scalar(query)
    if duplicate and not data.get("allowPossibleDuplicate"): raise HTTPException(409, detail={"duplicateWarning": True, "error": "A contact with the same email or same name under this manager already exists. Save it anyway?"})
    return account, owner, manager_id, email, duplicate is not None


@app.post("/api/contacts", status_code=201)
def create_contact(data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    account, owner, manager_id, email, duplicate = check_contact_write(db, data, user)
    c = Contact(stakeholder_id=str(data.get("stakeholderId") or f"SH-{uuid4().hex[:16].upper()}"), account_id=account.id, full_name=str(data["fullName"]).strip(), designation=data.get("designation"), practice=data.get("practice"), location=data["location"], email=email, phone=data.get("phone"), relationship_rating=data["relationshipRating"], owner_id=owner.id, reports_to_id=manager_id, route_via_vendor_management=bool(data.get("routeViaVendorManagement")), expected_annual_value=data.get("expectedAnnualValue"), annual_target=data.get("annualTarget"))
    db.add(c); db.flush(); audit(db, user, "Contact created", "Contact", c.id, c.stakeholder_id, new={"fullName": c.full_name, "accountId": c.account_id, "ownerId": c.owner_id, "possibleDuplicateOverride": duplicate}); db.commit()
    return contact_view(db, c, user.role != "User")


@app.patch("/api/contacts/{contact_id}")
def update_contact(contact_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    c = db.scalar(select(Contact).options(joinedload(Contact.account), joinedload(Contact.owner), joinedload(Contact.reports_to)).where(Contact.id == contact_id))
    if not c: raise HTTPException(404, "Contact not found.")
    account, owner, manager_id, email, duplicate = check_contact_write(db, data, user, c)
    before = {"accountId": c.account_id, "fullName": c.full_name, "designation": c.designation, "practice": c.practice, "location": c.location, "email": c.email, "phone": c.phone, "relationshipRating": c.relationship_rating, "ownerId": c.owner_id, "reportsToId": c.reports_to_id, "routeViaVendorManagement": c.route_via_vendor_management, "expectedAnnualValue": c.expected_annual_value, "annualTarget": c.annual_target}
    c.account_id = account.id; c.full_name = str(data["fullName"]).strip(); c.designation = data.get("designation"); c.practice = data.get("practice"); c.location = data["location"]; c.email = email; c.phone = data.get("phone"); c.relationship_rating = data["relationshipRating"]; c.owner_id = owner.id; c.reports_to_id = manager_id; c.route_via_vendor_management = bool(data.get("routeViaVendorManagement")); c.expected_annual_value = data.get("expectedAnnualValue"); c.annual_target = c.annual_target if user.role == "User" else data.get("annualTarget")
    after = {"accountId": c.account_id, "fullName": c.full_name, "designation": c.designation, "practice": c.practice, "location": c.location, "email": c.email, "phone": c.phone, "relationshipRating": c.relationship_rating, "ownerId": c.owner_id, "reportsToId": c.reports_to_id, "routeViaVendorManagement": c.route_via_vendor_management, "expectedAnnualValue": c.expected_annual_value, "annualTarget": c.annual_target, "possibleDuplicateOverride": duplicate}
    audit(db, user, "Contact updated", "Contact", c.id, c.stakeholder_id, before, after); db.commit(); db.refresh(c)
    return contact_view(db, c, user.role != "User")


@app.get("/api/contacts/owners")
def contact_owners(user: User = Depends(require_roles("Administrator", "BDLead")), db: Session = Depends(get_db)):
    return [{"id": u.id, "fullName": u.full_name, "email": u.email, "role": u.role, "isActive": u.is_active} for u in db.scalars(select(User).where(User.is_active.is_(True), User.role.in_(["User", "BDLead"]))).all()]


@app.post("/api/contacts/{contact_id}/view", status_code=204)
def record_view(contact_id: str, user: User = Depends(caller), db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c or (user.role == "User" and c.owner_id != user.id): raise HTTPException(404, "Contact not found.")
    row = db.get(RecentContact, (user.id, c.id))
    if row: row.viewed_at = datetime.now(timezone.utc)
    else: db.add(RecentContact(user_id=user.id, contact_id=c.id))
    db.commit(); return Response(status_code=204)


@app.get("/api/contacts/recent")
def recent_contacts(user: User = Depends(caller), db: Session = Depends(get_db)):
    rows = db.scalars(select(RecentContact).join(Contact).where(RecentContact.user_id == user.id, (Contact.owner_id == user.id) if user.role == "User" else True).order_by(RecentContact.viewed_at.desc()).limit(8)).all()
    return [{"id": row.contact_id, "stakeholderId": db.get(Contact, row.contact_id).stakeholder_id, "account": db.get(Contact, row.contact_id).account.name, "fullName": db.get(Contact, row.contact_id).full_name, "viewedAt": jsonable(row.viewed_at)} for row in rows]


@app.get("/api/activities")
def activities(contactId: str | None = None, user: User = Depends(caller), db: Session = Depends(get_db)):
    query = select(Activity).options(joinedload(Activity.contact), joinedload(Activity.logged_by)).order_by(Activity.occurred_at.desc())
    allowed = None
    if user.role == "User":
        allowed = {c.id for c in db.scalars(select(Contact.id).where(Contact.owner_id == user.id)).all()}
        query = query.where(or_(Activity.contact_id.in_(allowed or ["00000000-0000-0000-0000-000000000000"]), Activity.related_contact_ids.overlap(list(allowed))))
    if contactId: query = query.where(or_(Activity.contact_id == contactId, Activity.related_contact_ids.contains([contactId])))
    return [activity_view(a, allowed) for a in db.scalars(query).unique().all()]


@app.post("/api/activities", status_code=201)
def create_activity(data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    contact_id = data.get("contactId"); selected = list(dict.fromkeys([contact_id, *(data.get("contactIds") or [])])); cs = db.scalars(select(Contact).where(Contact.id.in_(selected))).all()
    if len(cs) != len(selected): raise HTTPException(404, "One or more selected contacts were not found.")
    if user.role == "User" and any(c.owner_id != user.id for c in cs): raise HTTPException(403, "You can only log activities for contacts you own.")
    typ = str(data.get("type", "")); outcome = data.get("outcome"); level = data.get("meetingLevel")
    if not typ or not outcome or not check_lookup(db, "ActivityType", typ) or not check_lookup(db, "ActivityOutcome", outcome): raise HTTPException(400, "Choose an approved interaction type and outcome.")
    summary = str(data.get("summary") or "").strip()
    if not summary or len(summary) > 250: raise HTTPException(400, "Add a discussion summary of at most 250 characters.")
    if typ == "Meeting (formal)" and (not level or not data.get("attendees")): raise HTTPException(400, "Formal meetings need a level and attendees.")
    if level and level not in ("L1", "L2", "L3"): raise HTTPException(400, "Meeting level must be L1, L2, or L3.")
    next_action = data.get("nextAction"); due = parse_datetime(data.get("nextActionDueAt"))
    if (not next_action or not str(next_action).strip() or not due) and any(c.relationship_rating != "Parked" for c in cs): raise HTTPException(400, "Add a next action and due date, unless all selected contacts are Parked.")
    owner_id = data.get("nextActionOwnerId") or user.id
    if user.role == "User" and owner_id != user.id: raise HTTPException(403, "Users can assign follow-ups only to themselves.")
    if next_action and due:
        task_owner = db.get(User, owner_id)
        if not task_owner or not task_owner.is_active: raise HTTPException(400, "Choose an active follow-up owner.")
    now = parse_datetime(data.get("occurredAt")) or datetime.now(timezone.utc)
    primary = next(c for c in cs if c.id == contact_id)
    a = Activity(contact_id=primary.id, related_contact_ids=[c.id for c in cs if c.id != primary.id], occurred_at=now, type=typ, outcome=outcome, meeting_level=level, attendees=data.get("attendees"), summary=summary, next_action=next_action, next_action_due_at=due, next_action_owner_id=owner_id, logged_by_id=user.id)
    old = {c.id: {"lastActivityAt": jsonable(c.last_activity_at), "lastDiscussion": c.last_discussion, "engagementStage": c.engagement_stage} for c in cs}
    stage = level or ("Connected" if outcome == "Connected" else "Contacted")
    for c in cs:
        if not c.last_activity_at or now >= c.last_activity_at:
            c.last_activity_at = now; c.last_discussion = a.summary
            if c.id == primary.id: c.next_action = next_action; c.next_follow_up_at = due
        if outcome == "Route via Vendor Management": c.route_via_vendor_management = True
        if STAGES.index(stage) > STAGES.index(c.engagement_stage): c.engagement_stage = stage
    db.add(a)
    if next_action and due: db.add(FollowUpTask(contact_id=primary.id, title=next_action.strip(), owner_id=owner_id, due_at=due))
    audit(db, user, "Activity logged", "Activity", a.id, a.id, new={"type": typ, "outcome": outcome, "meetingLevel": level, "contactIds": selected})
    for c in cs: audit(db, user, "Contact activity fields updated", "Contact", c.id, c.stakeholder_id, old[c.id], {"lastActivityAt": jsonable(c.last_activity_at), "lastDiscussion": c.last_discussion, "nextAction": c.next_action, "nextFollowUpAt": jsonable(c.next_follow_up_at), "engagementStage": c.engagement_stage, "routeViaVendorManagement": c.route_via_vendor_management})
    db.commit(); return {"id": a.id, "engagementStage": primary.engagement_stage, "followUpCreated": bool(next_action and due)}


def parse_datetime(value):
    if not value: return None
    if isinstance(value, datetime): return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")); return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError: raise HTTPException(400, "Invalid date or time value.")


@app.get("/api/tasks")
def tasks(bucket: str | None = None, user: User = Depends(caller), db: Session = Depends(get_db)):
    query = select(FollowUpTask).options(joinedload(FollowUpTask.contact), joinedload(FollowUpTask.owner)).order_by(FollowUpTask.due_at)
    if user.role == "User": query = query.where(FollowUpTask.owner_id == user.id)
    now = datetime.now(timezone.utc)
    if bucket == "Overdue": query = query.where(FollowUpTask.status != "Completed", FollowUpTask.due_at < now)
    elif bucket == "Due Today": query = query.where(FollowUpTask.status != "Completed", FollowUpTask.due_at >= datetime.combine(now.date(), datetime.min.time(), timezone.utc), FollowUpTask.due_at < datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone.utc))
    elif bucket == "Upcoming": query = query.where(FollowUpTask.status != "Completed", FollowUpTask.due_at >= datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone.utc))
    elif bucket == "Completed": query = query.where(FollowUpTask.status == "Completed")
    rows = db.scalars(query).unique().all()
    return [{"id": t.id, "contactId": t.contact_id, "contact": t.contact.full_name, "title": t.title, "ownerId": t.owner_id, "owner": t.owner.full_name, "dueAt": jsonable(t.due_at), "status": t.status, "bucket": "Completed" if t.status == "Completed" else "Overdue" if t.due_at < now else "Due Today" if t.due_at.date() == now.date() else "Upcoming"} for t in rows]


@app.patch("/api/tasks/{task_id}/complete")
def complete_task(task_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    task = db.scalar(select(FollowUpTask).options(joinedload(FollowUpTask.contact)).where(FollowUpTask.id == task_id))
    if not task or (user.role == "User" and task.owner_id != user.id): raise HTTPException(404, "Follow-up not found.")
    if task.status == "Completed": raise HTTPException(409, "This task is already completed.")
    next_action = str(data.get("nextAction") or "").strip(); due = parse_datetime(data.get("nextDueAt"))
    if bool(next_action) != bool(due): raise HTTPException(400, "Enter both a next action and due date, or leave both empty.")
    before = {"status": task.status, "dueAt": jsonable(task.due_at)}; contact_before = {"nextAction": task.contact.next_action, "nextFollowUpAt": jsonable(task.contact.next_follow_up_at)}
    task.status = "Completed"; task.completed_at = datetime.now(timezone.utc)
    if next_action and due:
        task.contact.next_action = next_action
        task.contact.next_follow_up_at = due
        db.add(FollowUpTask(contact_id=task.contact_id, title=next_action, owner_id=task.owner_id, due_at=due))
    else:
        task.contact.next_action = None
        task.contact.next_follow_up_at = None
    audit(db, user, "Follow-up completed", "Task", task.id, task.title, before, {"status": task.status, "nextAction": next_action, "nextDueAt": jsonable(due)})
    audit(db, user, "Contact follow-up fields updated", "Contact", task.contact.id, task.contact.stakeholder_id, contact_before, {"nextAction": task.contact.next_action, "nextFollowUpAt": jsonable(task.contact.next_follow_up_at)})
    db.commit()
    return {"id": task.id, "status": task.status, "nextTaskCreated": bool(next_action and due)}


@app.patch("/api/tasks/{task_id}/reopen")
def reopen_task(task_id: str, user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    task = db.scalar(select(FollowUpTask).where(FollowUpTask.id == task_id))
    if not task or (user.role == "User" and task.owner_id != user.id): raise HTTPException(404, "Follow-up not found.")
    if task.status != "Completed": raise HTTPException(409, "Only completed follow-ups can be reopened.")
    task.status = "Pending"; task.completed_at = None
    audit(db, user, "Follow-up reopened", "Task", task.id, task.title, {"status": "Completed"}, {"status": "Pending"})
    db.commit()
    return {"id": task.id, "status": task.status}


@app.get("/api/requirements")
def requirements(status: str | None = None, user: User = Depends(caller), db: Session = Depends(get_db)):
    q = select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions))
    if user.role == "User": q = q.where(Requirement.contact.has(Contact.owner_id == user.id))
    if status: q = q.where(Requirement.status == status)
    return [requirement_view(r, user.role != "User") for r in db.scalars(q.order_by(Requirement.date_received.desc())).unique().all()]


@app.get("/api/requirements/{requirement_id}")
def get_requirement(requirement_id: str, user: User = Depends(caller), db: Session = Depends(get_db)):
    r = db.scalar(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions)).where(Requirement.id == requirement_id))
    if not r or (user.role == "User" and r.contact.owner_id != user.id): raise HTTPException(404, "Requirement not found.")
    return requirement_view(r, user.role != "User")


def potential(data, count):
    kind = data.get("engagementType", "Contract")
    if kind == "Contract": return count * float(data.get("monthlyBillRate") or 0) * float(data.get("contractMonths") or 0)
    if kind == "Permanent hire": return count * float(data.get("feePerHire") or 0)
    return float(data.get("projectValue") or 0)


@app.post("/api/requirements", status_code=201)
def create_requirement(data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    c = db.get(Contact, data.get("contactId"))
    if not c or (user.role == "User" and c.owner_id != user.id): raise HTTPException(404, "Stakeholder not found.")
    meeting = db.scalar(select(Activity).where(Activity.id == data.get("sourceMeetingId"), Activity.contact_id == c.id, Activity.type == "Meeting (formal)", Activity.meeting_level.is_not(None), Activity.attendees.is_not(None)))
    if not meeting: raise HTTPException(400, "Choose the stakeholder's formal meeting with a level and attendees.")
    count = int(data.get("positionsRequested") or 0); kind = data.get("engagementType")
    if not data.get("roleTitle") or len(str(data.get("summary", ""))) > 250 or count < 1: raise HTTPException(400, "Enter a role, summary up to 250 characters, and at least one position.")
    if kind not in ("Contract", "Permanent hire", "Project/RPO"): raise HTTPException(400, "Choose an approved engagement type.")
    terms = {"Contract": (data.get("monthlyBillRate"), data.get("contractMonths")), "Permanent hire": (data.get("feePerHire"),), "Project/RPO": (data.get("projectValue"),)}[kind]
    try:
        if any(value is None or float(value) <= 0 for value in terms): raise ValueError()
        if kind == "Contract" and int(data["contractMonths"]) < 1: raise ValueError()
    except (ValueError, TypeError): raise HTTPException(400, "Enter all required commercial terms for this engagement type; rates and values must be greater than zero.")
    margin = default_margin(db, kind) if user.role == "User" else float(data.get("expectedMarginPercent") if data.get("expectedMarginPercent") is not None else default_margin(db, kind))
    if not 0 <= margin <= 100: raise HTTPException(400, "Expected margin must be from 0 to 100.")
    amount = potential(data, count)
    year = datetime.now(timezone.utc).year; sequence = len(db.scalars(select(Requirement.id).where(Requirement.date_received >= datetime(year, 1, 1, tzinfo=timezone.utc))).all()) + 1
    r = Requirement(requirement_code=f"REQ-{year}-{sequence:03}", contact_id=c.id, account_id=c.account_id, source_meeting_id=meeting.id, role_title=str(data["roleTitle"]).strip(), skills=data.get("skills"), positions_requested=count, experience_range=data.get("experienceRange"), work_location=data.get("workLocation"), bd_owner=user.full_name, engagement_type=kind, monthly_bill_rate=data.get("monthlyBillRate"), contract_months=data.get("contractMonths"), fee_per_hire=data.get("feePerHire"), project_value=data.get("projectValue"), expected_margin_percent=margin, potential_revenue=amount, potential_bottom_line=amount * margin / 100, summary=str(data.get("summary", "")).strip())
    r.positions = [Position(position_number=n) for n in range(1, count + 1)]; c.engagement_stage = "Requirement"; db.add(r); db.flush(); audit(db, user, "Requirement created", "Requirement", r.id, r.requirement_code, new={"roleTitle": r.role_title, "positions": count, "potentialRevenue": amount, "sourceMeeting": meeting.id}); db.commit()
    r = db.scalar(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions)).where(Requirement.id == r.id)); return requirement_view(r, user.role != "User")


@app.patch("/api/requirements/{requirement_id}")
def update_requirement(requirement_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    r = db.scalar(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions)).where(Requirement.id == requirement_id))
    if not r or (user.role == "User" and r.contact.owner_id != user.id): raise HTTPException(404, "Requirement not found.")
    if user.role == "User" and any(key in data for key in ("expectedMarginPercent", "potentialBottomLine", "realisedBottomLine")):
        raise HTTPException(403, "Only BD Leads and Administrators can edit margin values.")
    before = {"roleTitle": r.role_title, "skills": r.skills, "positionsRequested": r.positions_requested, "experienceRange": r.experience_range, "workLocation": r.work_location, "monthlyBillRate": r.monthly_bill_rate, "contractMonths": r.contract_months, "feePerHire": r.fee_per_hire, "projectValue": r.project_value, "expectedMarginPercent": r.expected_margin_percent, "potentialRevenue": r.potential_revenue, "potentialBottomLine": r.potential_bottom_line, "summary": r.summary}
    title = str(data.get("roleTitle", r.role_title)).strip(); count = int(data.get("positionsRequested", r.positions_requested)); summary = str(data.get("summary", r.summary)).strip()
    bill_rate = data.get("monthlyBillRate", r.monthly_bill_rate); months = data.get("contractMonths", r.contract_months); fee = data.get("feePerHire", r.fee_per_hire); project = data.get("projectValue", r.project_value)
    try:
        if not title or len(title) > 160 or count < 1 or len(summary) > 250: raise ValueError()
        terms = (bill_rate, months) if r.engagement_type == "Contract" else (fee,) if r.engagement_type == "Permanent hire" else (project,)
        if any(value is None or float(value) <= 0 for value in terms): raise ValueError()
        if r.engagement_type == "Contract" and int(months) < 1: raise ValueError()
        margin = r.expected_margin_percent if user.role == "User" else float(data.get("expectedMarginPercent", r.expected_margin_percent))
        if margin is None or not 0 <= float(margin) <= 100: raise ValueError()
    except (TypeError, ValueError): raise HTTPException(400, "Enter a valid role, position count, summary, commercial terms, and margin.")

    active_positions = [p for p in sorted(r.positions, key=lambda item: item.position_number) if p.status != "Cancelled"]
    if count < len(active_positions): raise HTTPException(400, "Position count cannot be lower than the number of positions already in progress. Cancel positions first if needed.")
    while len(r.positions) < count:
        r.positions.append(Position(position_number=max((p.position_number for p in r.positions), default=0) + 1))
    if count < len(r.positions):
        removable = sorted((p for p in r.positions if p.status == "Open"), key=lambda item: item.position_number, reverse=True)
        while len(r.positions) > count and removable:
            position = removable.pop(0); r.positions.remove(position)
        if len(r.positions) > count: raise HTTPException(400, "Only unassigned open positions can be removed.")

    r.role_title = title; r.skills = data.get("skills", r.skills); r.positions_requested = count; r.experience_range = data.get("experienceRange", r.experience_range); r.work_location = data.get("workLocation", r.work_location); r.monthly_bill_rate = bill_rate; r.contract_months = months; r.fee_per_hire = fee; r.project_value = project; r.expected_margin_percent = margin; r.summary = summary
    r.potential_revenue = potential({"engagementType": r.engagement_type, "monthlyBillRate": bill_rate, "contractMonths": months, "feePerHire": fee, "projectValue": project}, count)
    r.potential_bottom_line = r.potential_revenue * float(margin) / 100; recalculate(r)
    if r.status != "On Hold": r.status = derive_status(r)
    after = {"roleTitle": r.role_title, "skills": r.skills, "positionsRequested": r.positions_requested, "experienceRange": r.experience_range, "workLocation": r.work_location, "monthlyBillRate": r.monthly_bill_rate, "contractMonths": r.contract_months, "feePerHire": r.fee_per_hire, "projectValue": r.project_value, "expectedMarginPercent": r.expected_margin_percent, "potentialRevenue": r.potential_revenue, "potentialBottomLine": r.potential_bottom_line, "summary": r.summary}
    audit(db, user, "Requirement details and value updated", "Requirement", r.id, r.requirement_code, before, after); db.commit()
    return requirement_view(r, user.role != "User")


def derive_status(r: Requirement):
    positions = r.positions; joined = sum(p.status == "Joined" for p in positions); cancelled = sum(p.status == "Cancelled" for p in positions)
    if joined and joined + cancelled == r.positions_requested: return "Closed Won"
    if joined: return "Partially Filled"
    if all(p.status == "Cancelled" for p in positions): return "Closed Lost"
    for state, label in [("Offered", "Offer Made"), ("Interviewing", "Interviews"), ("ProfilesShared", "Profiles Shared")]:
        if any(p.status == state for p in positions): return label
    return "New"


def recalculate(r: Requirement):
    joined = [p for p in r.positions if p.status == "Joined"]
    def revenue(p):
        if r.engagement_type == "Contract": return float(p.actual_bill_rate_or_fee or 0) * int(r.contract_months or 0)
        if r.engagement_type == "Permanent hire": return float(p.actual_bill_rate_or_fee or 0)
        return float(r.project_value or 0) / max(r.positions_requested, 1)
    r.realised_revenue = sum(revenue(p) for p in joined)
    r.realised_bottom_line = sum(revenue(p) * float(p.actual_margin_percent or 0) / 100 for p in joined)


@app.patch("/api/requirements/{requirement_id}/status")
def requirement_status(requirement_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead")), db: Session = Depends(get_db)):
    r = db.scalar(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions)).where(Requirement.id == requirement_id))
    if not r: raise HTTPException(404, "Requirement not found.")
    status = data.get("status")
    if status not in ("On Hold", "Resume"):
        raise HTTPException(400, "Requirement stage is derived from position fulfilment. You may place it On Hold or resume it to its derived stage.")
    before = r.status; r.status = "On Hold" if status == "On Hold" else derive_status(r)
    audit(db, user, "Requirement placed on hold" if r.status == "On Hold" else "Requirement resumed", "Requirement", r.id, r.requirement_code, before, r.status); db.commit(); return requirement_view(r, user.role != "User")


@app.patch("/api/requirements/{requirement_id}/positions/{position_id}")
def update_position(requirement_id: str, position_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    r = db.scalar(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions)).where(Requirement.id == requirement_id))
    if not r or (user.role == "User" and r.contact.owner_id != user.id): raise HTTPException(404, "Requirement not found.")
    if user.role == "User" and "actualMarginPercent" in data: raise HTTPException(403, "Only BD Leads and Administrators can edit margin values.")
    p = next((item for item in r.positions if item.id == position_id), None)
    if not p: raise HTTPException(404, "Position not found.")
    status = str(data.get("status", "Open"))
    if status not in ("Open", "ProfilesShared", "Interviewing", "Offered", "Joined", "Dropped", "Cancelled"): raise HTTPException(400, "Choose an approved position status.")
    if data.get("actualRateOrFee") is not None and float(data["actualRateOrFee"]) < 0: raise HTTPException(400, "Actual rate or fee cannot be negative.")
    if data.get("actualMarginPercent") is not None and not 0 <= float(data["actualMarginPercent"]) <= 100: raise HTTPException(400, "Actual margin must be 0 to 100 percent.")
    before = {"status": p.status, "candidateName": p.candidate_name, "joiningDate": jsonable(p.joining_date), "actualRateOrFee": p.actual_bill_rate_or_fee, "actualMarginPercent": p.actual_margin_percent}; requested_status = status
    p.status = "Open" if status == "Dropped" else status; p.candidate_name = None if status == "Dropped" else data.get("candidateName"); p.joining_date = None if status == "Dropped" or not data.get("joiningDate") else date.fromisoformat(data["joiningDate"]); p.actual_bill_rate_or_fee = None if status == "Dropped" else data.get("actualRateOrFee"); p.actual_margin_percent = None if status == "Dropped" else (r.expected_margin_percent if user.role == "User" and status == "Joined" else data.get("actualMarginPercent"))
    if p.status == "Joined" and (not p.candidate_name or not p.joining_date or p.actual_bill_rate_or_fee is None or p.actual_margin_percent is None): raise HTTPException(400, "Joined positions need a candidate, joining date, actual rate or fee, and actual margin.")
    old_status = r.status; recalculate(r); r.status = derive_status(r)
    after = {"status": p.status, "candidateName": p.candidate_name, "joiningDate": jsonable(p.joining_date), "actualRateOrFee": p.actual_bill_rate_or_fee, "actualMarginPercent": p.actual_margin_percent}
    audit(db, user, "Candidate dropped; position reopened" if requested_status == "Dropped" else "Position fulfilment changed", "Requirement", r.id, r.requirement_code, before, after)
    if old_status != r.status: audit(db, user, "Requirement stage derived from fulfilment", "Requirement", r.id, r.requirement_code, old_status, r.status)
    db.commit(); return requirement_view(r, user.role != "User")


@app.get("/api/contact-views")
def list_views(user: User = Depends(caller), db: Session = Depends(get_db)):
    return [{"id": v.id, "name": v.name, "baseView": v.base_view, "query": v.query, "sort": v.sort, "ratingFilter": v.rating_filter} for v in db.scalars(select(SavedContactView).where(SavedContactView.user_id == user.id).order_by(SavedContactView.name)).all()]


@app.post("/api/contact-views")
def save_view(data: dict[str, Any], user: User = Depends(caller), db: Session = Depends(get_db)):
    name = str(data.get("name", "")).strip()
    if not name: raise HTTPException(400, "View name is required.")
    if db.scalar(select(SavedContactView.id).where(SavedContactView.user_id == user.id, SavedContactView.name == name)): raise HTTPException(409, "A saved view with that name already exists.")
    v = SavedContactView(user_id=user.id, name=name, base_view=str(data.get("baseView", "All")), query=str(data.get("query", "")), sort=str(data.get("sort", "fullName")), rating_filter=str(data.get("ratingFilter", ""))); db.add(v); db.flush(); audit(db, user, "Contact view saved", "SavedView", v.id, v.name); db.commit(); return {"id": v.id, "name": v.name, "baseView": v.base_view, "query": v.query, "sort": v.sort, "ratingFilter": v.rating_filter}


@app.put("/api/contact-views/{view_id}")
def update_view(view_id: str, data: dict[str, Any], user: User = Depends(caller), db: Session = Depends(get_db)):
    v = db.scalar(select(SavedContactView).where(SavedContactView.id == view_id, SavedContactView.user_id == user.id))
    if not v: raise HTTPException(404, "Saved view not found.")
    before = {"name": v.name, "query": v.query, "sort": v.sort}; v.name = str(data.get("name", v.name)).strip(); v.base_view = str(data.get("baseView", v.base_view)); v.query = str(data.get("query", v.query)); v.sort = str(data.get("sort", v.sort)); v.rating_filter = str(data.get("ratingFilter", v.rating_filter)); audit(db, user, "Contact view updated", "SavedView", v.id, v.name, before, {"name": v.name, "query": v.query, "sort": v.sort}); db.commit(); return {"id": v.id, "name": v.name, "baseView": v.base_view, "query": v.query, "sort": v.sort, "ratingFilter": v.rating_filter}


@app.delete("/api/contact-views/{view_id}", status_code=204)
def delete_view(view_id: str, user: User = Depends(caller), db: Session = Depends(get_db)):
    v = db.scalar(select(SavedContactView).where(SavedContactView.id == view_id, SavedContactView.user_id == user.id))
    if not v: raise HTTPException(404, "Saved view not found.")
    audit(db, user, "Contact view deleted", "SavedView", v.id, v.name); db.delete(v); db.commit(); return Response(status_code=204)


@app.get("/api/admin/users")
def admin_users(user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    return [{"id": u.id, "email": u.email, "fullName": u.full_name, "role": u.role, "isActive": u.is_active, "mustChangePassword": u.must_change_password} for u in db.scalars(select(User).order_by(User.full_name)).all()]


@app.post("/api/admin/users", status_code=201)
def admin_create_user(data: dict[str, Any], user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    email = str(data.get("email", "")).strip().lower(); name = str(data.get("fullName", "")).strip(); role = ROLE_NAMES.get(str(data.get("role", "User")))
    if not name or not email or not role: raise HTTPException(400, "Enter a name, email, and approved role.")
    if db.scalar(select(User.id).where(User.email == email)): raise HTTPException(409, "Enter a unique email address.")
    user_new = User(email=email, full_name=name, role=role, password_hash=hash_password(secrets.token_urlsafe(32)), must_change_password=True); token = secrets.token_urlsafe(32); user_new.password_reset_token_hash = hashlib.sha256(token.encode()).hexdigest(); user_new.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    db.add(user_new); db.flush(); email_sent = send_email(email, "Set up your BD CRM account", f"Use this one-time link within 30 minutes:\n{settings.frontend_base_url}/login?email={email}&token={token}"); audit(db, user, "User created", "User", user_new.id, email, new=role); db.commit()
    return {"id": user_new.id, "email": user_new.email, "fullName": user_new.full_name, "role": user_new.role, "resetLinkSent": email_sent}


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "User not found.")
    active = data.get("isActive", target.is_active); role = ROLE_NAMES.get(str(data.get("role", target.role)))
    if target.id == user.id and active is False: raise HTTPException(400, "You cannot deactivate your own account.")
    if not role: raise HTTPException(400, "Choose an approved role.")
    before = {"isActive": target.is_active, "role": target.role}; target.is_active = bool(active); target.role = role; target.token_version += 1; audit(db, user, "User permissions changed", "User", target.id, target.email, before, {"isActive": target.is_active, "role": target.role}); db.commit()
    return {"id": target.id, "email": target.email, "fullName": target.full_name, "role": target.role, "isActive": target.is_active}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_user(user_id: str, user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or not target.is_active: raise HTTPException(404, "Active user not found.")
    token = secrets.token_urlsafe(32); target.password_reset_token_hash = hashlib.sha256(token.encode()).hexdigest(); target.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30); target.must_change_password = True; target.token_version += 1
    email_sent = send_email(target.email, "Reset your BD CRM password", f"Use this one-time link within 30 minutes:\n{settings.frontend_base_url}/login?email={target.email}&token={token}"); audit(db, user, "Administrator password reset link requested", "User", target.id, target.email, new="Setup link sent" if email_sent else "Email not configured"); db.commit(); return {"message": "A one-time password setup link was sent." if email_sent else "The reset token was created, but email could not be sent. Configure SMTP and try again.", "resetLinkSent": email_sent}


@app.get("/api/admin/dropdowns")
def admin_dropdowns(user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    return [{"id": d.id, "category": d.category, "value": d.value, "sortOrder": d.sort_order, "isActive": d.is_active} for d in db.scalars(select(DropdownValue).order_by(DropdownValue.category, DropdownValue.sort_order)).all()]


@app.post("/api/admin/dropdowns")
def admin_add_dropdown(data: dict[str, Any], user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    category = str(data.get("category", "")).strip(); value = str(data.get("value", "")).strip()
    if not category or not value: raise HTTPException(400, "Category and value are required.")
    is_margin = category == "DefaultMarginPercent" or category.startswith("DefaultMarginPercent:")
    if is_margin and (not value.replace(".", "", 1).isdigit() or not 0 <= float(value) <= 100): raise HTTPException(400, "Default margin must be from 0 to 100.")
    if category.startswith("DefaultMarginPercent:") and category.split(":", 1)[1] not in ("Contract", "Permanent hire", "Project/RPO"): raise HTTPException(400, "Choose an approved engagement type for the margin default.")
    existing = db.scalar(select(DropdownValue).where(DropdownValue.category == category, DropdownValue.value == value))
    if existing:
        if not is_margin and existing.is_active: raise HTTPException(409, "That value already exists.")
        old = existing.value; existing.value = value; existing.is_active = True; existing.sort_order = int(data.get("sortOrder", 0)); d = existing
    else: old = None; d = DropdownValue(category=category, value=value, sort_order=int(data.get("sortOrder", 0))); db.add(d)
    if is_margin:
        for prior in db.scalars(select(DropdownValue).where(DropdownValue.category == category, DropdownValue.id != d.id, DropdownValue.is_active.is_(True))).all(): prior.is_active = False
    audit(db, user, "Default requirement margin changed" if is_margin else "Dropdown value added", "Setting" if is_margin else "DropdownValue", d.id, category, old, value); db.commit(); return {"id": d.id, "category": d.category, "value": d.value, "sortOrder": d.sort_order, "isActive": d.is_active}


@app.patch("/api/admin/dropdowns/{dropdown_id}")
def admin_update_dropdown(dropdown_id: str, data: dict[str, Any], user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    d = db.get(DropdownValue, dropdown_id)
    if not d: raise HTTPException(404, "Dropdown value not found.")
    old = {"category": d.category, "value": d.value, "sortOrder": d.sort_order, "isActive": d.is_active}; new_value = str(data.get("value", d.value)).strip()
    if (d.category == "DefaultMarginPercent" or d.category.startswith("DefaultMarginPercent:")) and (not new_value.replace(".", "", 1).isdigit() or not 0 <= float(new_value) <= 100): raise HTTPException(400, "Default margin must be from 0 to 100.")
    d.category = str(data.get("category", d.category)).strip(); d.value = new_value; d.sort_order = int(data.get("sortOrder", d.sort_order)); d.is_active = bool(data.get("isActive", d.is_active)); audit(db, user, "Dropdown value changed", "DropdownValue", d.id, d.value, old, {"category": d.category, "value": d.value, "sortOrder": d.sort_order, "isActive": d.is_active}); db.commit(); return {"id": d.id, "category": d.category, "value": d.value, "sortOrder": d.sort_order, "isActive": d.is_active}


@app.get("/api/admin/notification-recipients")
def notification_recipients(user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    item = db.get(NotificationSetting, 1); return {"emails": (item.weekly_report_recipients if item else "").replace(";", ",").replace("\n", ",").split(",") if item else []}


@app.put("/api/admin/notification-recipients")
def set_notification_recipients(data: dict[str, Any], user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    emails = list(dict.fromkeys(str(email).strip().lower() for email in data.get("emails", []) if str(email).strip()))
    if any("@" not in email or "." not in email.split("@")[-1] for email in emails): raise HTTPException(400, "Enter valid email addresses.")
    item = db.get(NotificationSetting, 1)
    if not item: item = NotificationSetting(id=1); db.add(item)
    old = item.weekly_report_recipients; item.weekly_report_recipients = ";".join(emails); audit(db, user, "Weekly report recipients changed", "NotificationSetting", key="weekly-report", old=old, new=item.weekly_report_recipients); db.commit(); return {"emails": emails}


@app.get("/api/audit")
def audit_list(search: str | None = None, user: User = Depends(require_roles("Administrator")), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(500)).all(); result = []
    for row in rows:
        u = db.get(User, row.user_id) if row.user_id else None
        if search and search.lower() not in " ".join([row.action, row.entity_type, row.record_key or "", u.full_name if u else "System"]).lower(): continue
        result.append({"id": row.id, "user": u.full_name if u else "System", "action": row.action, "entityType": row.entity_type, "record": row.record_key or row.record_id, "oldValue": json.dumps(row.old_value) if row.old_value is not None else None, "newValue": json.dumps(row.new_value) if row.new_value is not None else None, "createdAt": jsonable(row.created_at)})
    return result


@app.post("/api/import/contacts")
def import_contacts(data: dict[str, Any], user: User = Depends(require_roles("Administrator", "BDLead", "User")), db: Session = Depends(get_db)):
    rows = data.get("rows", [])
    if not isinstance(rows, list) or not 1 <= len(rows) <= 5000: raise HTTPException(400, "Import between 1 and 5,000 rows at a time.")
    accounts_by_name = {a.name.lower(): a for a in db.scalars(select(Account)).all()}; team = db.scalars(select(User).where(User.is_active.is_(True))).all()
    contacts_all = db.scalars(select(Contact).options(joinedload(Contact.account), joinedload(Contact.reports_to), joinedload(Contact.owner))).unique().all()
    seen_ids: set[str] = set(); seen_emails: set[str] = set(); rejected = []; created = updated = 0
    for row in rows:
        errors = []; name = str(row.get("fullName") or "").strip(); email = str(row.get("email") or "").strip().lower() or None; sid = str(row.get("stakeholderId") or "").strip()
        account = accounts_by_name.get(str(row.get("account") or "").strip().lower()); owner = next((u for u in team if u.full_name.lower() == str(row.get("bdOwner") or "").strip().lower()), None)
        if not name or not row.get("location") or not account: errors.append("Name, account, and location are required or account is unknown.")
        if not check_lookup(db, "RelationshipRating", row.get("relationshipStatus")): errors.append("Unknown relationship status.")
        if not check_lookup(db, "Location", row.get("location")): errors.append("Unknown location.")
        if sid and sid.lower() in seen_ids: errors.append("Duplicate stakeholder ID in this upload.")
        if email and email in seen_emails: errors.append("Duplicate email in this upload.")
        if sid: seen_ids.add(sid.lower())
        if email: seen_emails.add(email)
        existing = next((c for c in contacts_all if (sid and c.stakeholder_id.lower() == sid.lower()) or (email and (c.email or "").lower() == email)), None)
        if user.role == "User":
            if existing and existing.owner_id != user.id: errors.append("Users cannot import another owner's contact.")
            if row.get("bdOwner") and str(row["bdOwner"]).lower() != user.full_name.lower(): errors.append("Users can import only their own contacts.")
            owner = user
        elif not owner: errors.append("Choose an active BD owner.")
        manager = next((c for c in contacts_all if c.full_name.lower() == str(row.get("reportsTo") or "").strip().lower() and account and c.account_id == account.id), None)
        if row.get("reportsTo") and not manager: errors.append("Reports To contact was not found in this account.")
        same_person = next((c for c in contacts_all if c is not existing and account and c.account_id == account.id and c.full_name.lower() == name.lower() and c.reports_to_id == (manager.id if manager else None)), None)
        if same_person: errors.append("A contact with the same name under this manager already exists in this account.")
        if errors: rejected.append({"row": sid or name, "errors": errors}); continue
        if existing:
            existing.account_id = account.id; existing.full_name = name; existing.designation = row.get("designation"); existing.practice = row.get("practice"); existing.location = row["location"]; existing.email = email; existing.phone = row.get("phone"); existing.relationship_rating = row["relationshipStatus"]; existing.owner_id = owner.id; existing.reports_to_id = manager.id if manager else None; existing.route_via_vendor_management = bool(row.get("routeViaVendorManagement")); updated += 1
        else:
            existing = Contact(stakeholder_id=sid or f"SH-{uuid4().hex[:15].upper()}", account_id=account.id, full_name=name, designation=row.get("designation"), practice=row.get("practice"), location=row["location"], email=email, phone=row.get("phone"), relationship_rating=row["relationshipStatus"], owner_id=owner.id, reports_to_id=manager.id if manager else None, route_via_vendor_management=bool(row.get("routeViaVendorManagement")))
            db.add(existing); contacts_all.append(existing); created += 1
    if created or updated: audit(db, user, "Contact import confirmed", "Import", key=str(data.get("fileName", "contact-import")), new={"created": created, "updated": updated, "rejected": len(rejected)}); db.commit()
    else: db.rollback()
    return {"created": created, "updated": updated, "rejected": rejected}


@app.get("/api/reports/dashboard")
def reports_dashboard(user: User = Depends(caller), db: Session = Depends(get_db)):
    cs = visible_contacts(db, user); ids = {c.id for c in cs}; now = datetime.now(timezone.utc); today = now.date()
    acts = db.scalars(select(Activity).options(joinedload(Activity.contact), joinedload(Activity.logged_by)).where(Activity.contact_id.in_(ids or ["00000000-0000-0000-0000-000000000000"]) | Activity.related_contact_ids.overlap(list(ids))).order_by(Activity.occurred_at.desc())).unique().all()
    ts = db.scalars(select(FollowUpTask).options(joinedload(FollowUpTask.contact), joinedload(FollowUpTask.owner))).all(); ts = [t for t in ts if (user.role != "User" or t.owner_id == user.id)]
    rs = db.scalars(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account), joinedload(Requirement.positions))).unique().all(); rs = [r for r in rs if user.role != "User" or r.contact_id in ids]
    week_start = today - timedelta(days=6); start_week = datetime.combine(week_start, datetime.min.time(), timezone.utc); end_today = datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone.utc)
    week = [a for a in acts if start_week <= a.occurred_at < end_today]
    overdue = [t for t in ts if t.status != "Completed" and t.due_at.date() < today]
    open_rs = [r for r in rs if r.status not in ("Closed Won", "Closed Lost")]
    quiet = [c for c in cs if not c.last_activity_at or c.last_activity_at < now - timedelta(days=30)]
    by_person = {}
    for a in week:
        person = a.logged_by.full_name if a.logged_by else "CRM user"; item = by_person.setdefault(person, {"person": person, "calls": 0, "emails": 0, "meetings": 0, "other": 0})
        if a.type == "Call": item["calls"] += 1
        elif a.type == "Email": item["emails"] += 1
        elif a.type.startswith("Meeting"): item["meetings"] += 1
        else: item["other"] += 1
    ratings = [{"status": status, "count": sum(c.relationship_rating == status for c in cs)} for status in DEFAULTS["RelationshipRating"]]
    pipeline = [{"stage": s, "count": sum(c.engagement_stage == s for c in cs), "contacts": [{"id": c.id, "fullName": c.full_name} for c in cs if c.engagement_stage == s]} for s in STAGES]
    rstatuses = [{"status": s, "count": sum(r.status == s for r in rs)} for s in DEFAULTS["RequirementStatus"]]
    by_quality = []
    for c in cs:
        missing = [label for condition, label in [(not c.email, "Email"), (not c.designation, "Designation"), (not c.practice, "Practice"), (not c.owner_id, "Owner")] if condition]
        if missing: by_quality.append({"id": c.id, "fullName": c.full_name, "missing": missing})
    max_date = max([a.occurred_at for a in acts if a.occurred_at.date() <= today] + [r.date_received for r in rs if r.date_received.date() <= today], default=None)
    return {"generatedAt": jsonable(now), "weekStart": week_start.isoformat(), "today": today.isoformat(), "latestRecordAt": jsonable(max_date), "summary": {"mappedContacts": len(cs), "meetingsHeld": sum(a.type.startswith("Meeting") and a.occurred_at.date() <= today for a in acts), "openRequirements": len(open_rs), "openPositions": sum(r.positions_requested for r in open_rs), "overdueFollowUps": len(overdue)}, "relationshipDistribution": ratings, "dataQuality": None if user.role == "User" else {"contactsReviewed": len(cs), "contactsWithGaps": len(by_quality), "completenessPercent": round((len(cs) - len(by_quality)) / len(cs) * 100, 1) if cs else 100, "records": by_quality}, "pipeline": pipeline, "activityByPerson": list(by_person.values()), "weekActivities": [{"id": a.id, "contactId": a.contact_id, "date": a.occurred_at.date().isoformat(), "loggedBy": a.logged_by.full_name if a.logged_by else "CRM user", "type": a.type, "outcome": a.outcome} for a in week], "overdueTasks": [{"id": t.id, "contactId": t.contact_id, "contact": t.contact.full_name, "title": t.title, "owner": t.owner.full_name, "dueDate": t.due_at.date().isoformat()} for t in overdue], "requirementsByStatus": rstatuses, "openRequirementsList": [{"id": r.id, "roleTitle": r.role_title, "positions": r.positions_requested, "status": r.status} for r in open_rs], "quietContacts": [{"id": c.id, "fullName": c.full_name, "designation": c.designation, "owner": c.owner.full_name if c.owner else "Unassigned", "lastActivityAt": jsonable(c.last_activity_at.date()) if c.last_activity_at else None} for c in quiet], "hierarchy": [{"id": c.id, "fullName": c.full_name, "designation": c.designation, "relationshipRating": c.relationship_rating, "reportsToId": c.reports_to_id, "reportsTo": c.reports_to.full_name if c.reports_to else None} for c in cs]}


def csv_response(filename: str, headers: list[str], rows: list[list[Any]], db: Session, user: User):
    output = io.StringIO(); writer = csv.writer(output); writer.writerow(headers)
    for row in rows:
        writer.writerow([("'" + str(value) if isinstance(value, str) and value.lstrip()[:1] in ("=", "+", "-", "@", "\t", "\r") else "" if value is None else value) for value in row])
    audit(db, user, "CRM export downloaded", "Export", key=filename, new={"count": len(rows)}); db.commit()
    return Response(content="\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/exports/contacts.csv")
def export_contacts(user: User = Depends(caller), db: Session = Depends(get_db)):
    rows = visible_contacts(db, user)
    return csv_response("bd-crm-contacts.csv", ["Stakeholder ID", "Full Name", "Account", "Designation", "Practice", "Location", "Relationship Rating", "Owner", "Email", "Phone", "Reports To", "Vendor Route", "Last Activity", "Next Follow-up"], [[c.stakeholder_id, c.full_name, c.account.name, c.designation, c.practice, c.location, c.relationship_rating, c.owner.full_name if c.owner else None, c.email, c.phone, c.reports_to.full_name if c.reports_to else None, "Yes" if c.route_via_vendor_management else "No", c.last_activity_at.date().isoformat() if c.last_activity_at else None, c.next_follow_up_at.date().isoformat() if c.next_follow_up_at else None] for c in rows], db, user)


@app.get("/api/exports/requirements.csv")
def export_requirements(user: User = Depends(caller), db: Session = Depends(get_db)):
    rs = db.scalars(select(Requirement).options(joinedload(Requirement.contact), joinedload(Requirement.account)).order_by(Requirement.date_received.desc())).unique().all(); rs = [r for r in rs if user.role != "User" or r.contact.owner_id == user.id]
    return csv_response("bd-crm-requirements.csv", ["Requirement ID", "Role", "Account", "Stakeholder", "Positions", "Location", "Received", "Status", "Engagement Type", "Potential Revenue", "Expected Bottom Line", "Realised Revenue", "Realised Bottom Line", "Owner"], [[r.requirement_code, r.role_title, r.account.name, r.contact.full_name, r.positions_requested, r.work_location, r.date_received.date().isoformat(), r.status, r.engagement_type, r.potential_revenue, "" if user.role == "User" else r.potential_bottom_line, r.realised_revenue, "" if user.role == "User" else r.realised_bottom_line, r.bd_owner] for r in rs], db, user)


@app.get("/api/exports/activities.csv")
def export_activities(user: User = Depends(caller), db: Session = Depends(get_db)):
    rows = db.scalars(select(Activity).options(joinedload(Activity.contact).joinedload(Contact.account), joinedload(Activity.logged_by)).order_by(Activity.occurred_at.desc())).unique().all()
    if user.role == "User": rows = [a for a in rows if a.contact.owner_id == user.id or user.id in (a.related_contact_ids or [])]
    return csv_response("bd-crm-activities.csv", ["Date", "Contact", "Account", "Type", "Outcome", "Meeting level", "Attendees", "Summary", "Next action", "Logged by"], [[a.occurred_at.date().isoformat(), a.contact.full_name, a.contact.account.name, a.type, a.outcome, a.meeting_level, a.attendees, a.summary, a.next_action, a.logged_by.full_name if a.logged_by else "CRM user"] for a in rows], db, user)


@app.get("/api/exports/follow-ups.csv")
def export_tasks(user: User = Depends(caller), db: Session = Depends(get_db)):
    rows = db.scalars(select(FollowUpTask).options(joinedload(FollowUpTask.contact).joinedload(Contact.account), joinedload(FollowUpTask.owner)).order_by(FollowUpTask.due_at)).unique().all()
    if user.role == "User": rows = [t for t in rows if t.owner_id == user.id]
    return csv_response("bd-crm-follow-ups.csv", ["Due date", "Contact", "Account", "Task", "Owner", "Status"], [[t.due_at.date().isoformat(), t.contact.full_name, t.contact.account.name, t.title, t.owner.full_name, t.status] for t in rows], db, user)


@app.get("/api/exports/accounts.csv")
def export_accounts(user: User = Depends(caller), db: Session = Depends(get_db)):
    accs = db.scalars(select(Account).options(joinedload(Account.contacts), joinedload(Account.requirements).joinedload(Requirement.contact))).unique().all(); rows = []
    for a in accs:
        cs = [c for c in a.contacts if user.role != "User" or c.owner_id == user.id]
        if user.role == "User" and not cs: continue
        rs = [r for r in a.requirements if user.role != "User" or r.contact_id in {c.id for c in cs}]; op = [r for r in rs if r.status not in ("Closed Won", "Closed Lost")]
        rows.append([a.name, a.status, a.description, len(cs), len(rs), sum(r.positions_requested for r in op), sum(float(r.potential_revenue or 0) for r in rs), "" if user.role == "User" else sum(float(r.potential_bottom_line or 0) for r in rs), sum(float(r.realised_revenue or 0) for r in rs), "" if user.role == "User" else sum(float(r.realised_bottom_line or 0) for r in rs)])
    return csv_response("bd-crm-accounts.csv", ["Account", "Status", "Description", "Contacts", "Requirements", "Open positions", "Potential revenue", "Potential bottom line", "Realised revenue", "Realised bottom line"], rows, db, user)


@app.get("/api/exports/reports/dashboard.csv")
def export_dashboard_report(user: User = Depends(caller), db: Session = Depends(get_db)):
    report = reports_dashboard(user, db)
    rows = [["Report metadata", "Last updated", report["generatedAt"], ""]]
    for label, value in report["summary"].items(): rows.append(["Account overview", label, value, ""])
    for item in report["relationshipDistribution"]: rows.append(["Account overview", f"{item['status']} contacts", item["count"], "Relationship rating"])
    for item in report["pipeline"]: rows.append(["Pipeline by stage", item["stage"], item["count"], "; ".join(person["fullName"] for person in item["contacts"])])
    for item in report["activityByPerson"]: rows.append(["Activity this week", item["person"], item["calls"] + item["emails"] + item["meetings"], f"Calls {item['calls']}; emails {item['emails']}; meetings {item['meetings']}"])
    for item in report["overdueTasks"]: rows.append(["Overdue follow-ups", item["title"], item["dueDate"], f"{item['contact']} / {item['owner']}"])
    for item in report["openRequirementsList"]: rows.append(["Open requirements", item["roleTitle"], item["positions"], item["status"]])
    for item in report["quietContacts"]: rows.append(["Contacts gone quiet", item["fullName"], item["lastActivityAt"] or "Never contacted", item["owner"]])
    for item in report["hierarchy"]: rows.append(["Stakeholder hierarchy", item["fullName"], item["relationshipRating"], f"Reports to {item['reportsTo']}" if item["reportsTo"] else "Top of branch"])
    return csv_response("bd-crm-reports.csv", ["Report", "Metric or record", "Value", "Details"], rows, db, user)



